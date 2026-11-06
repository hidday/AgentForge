import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeProcessResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 10,
    timedOut: false,
    ...overrides,
  };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs()", () => {
  it("builds the expected per-runtime probe configuration", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--ignored"],
      "codex",
      ["exec", "-"],
      "cursor-agent",
    );

    expect(configs["claude-code"]).toEqual({
      command: "claude",
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });
    expect(configs.codex).toEqual({
      command: "codex",
      versionArgs: ["--version"],
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });
    expect(configs.cursor).toEqual({
      command: "cursor-agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes() / getLastResult()", () => {
  it("returns the set of runtimes actually used by AGENT_STAGES (claude-code and codex, not cursor)", () => {
    const processRunner = { execute: vi.fn() };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const healthCheck = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    const required = healthCheck.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });

  it("returns undefined before any preflight has run", () => {
    const processRunner = { execute: vi.fn() };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const healthCheck = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    expect(healthCheck.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck private probe helpers (checkBinary / checkAuth)", () => {
  function build(execute: ReturnType<typeof vi.fn>) {
    const processRunner = { execute };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const logger = makeMockLogger();
    const healthCheck = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    return { healthCheck: healthCheck as unknown as Record<string, (...a: unknown[]) => unknown>, logger, configs };
  }

  it("checkBinary: ok=true with a trimmed, truncated first line of version output", async () => {
    const execute = vi.fn().mockResolvedValue(
      makeProcessResult({ stdout: `  v1.2.3 (build 456)\nextra line\n`, exitCode: 0 }),
    );
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.checkBinary(configs["claude-code"])) as {
      ok: boolean;
      version?: string;
    };

    expect(result.ok).toBe(true);
    expect(result.version).toBe("v1.2.3 (build 456)");
  });

  it("checkBinary: ok=false when the process times out", async () => {
    const execute = vi.fn().mockResolvedValue(makeProcessResult({ timedOut: true }));
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.checkBinary(configs["claude-code"])) as {
      ok: boolean;
      error?: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Timed out after");
  });

  it("checkBinary: ok=false with the exit code and stderr snippet on non-zero exit", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue(makeProcessResult({ exitCode: 127, stderr: "command not found" }));
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.checkBinary(configs["claude-code"])) as {
      ok: boolean;
      error?: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Exit code 127");
    expect(result.error).toContain("command not found");
  });

  it("checkBinary: ok=false with the error message when execute throws", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("ENOENT: spawn failed"));
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.checkBinary(configs["claude-code"])) as {
      ok: boolean;
      error?: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toBe("ENOENT: spawn failed");
  });

  it("checkBinary: ok=false with a stringified error when a non-Error is thrown", async () => {
    const execute = vi.fn().mockRejectedValue("raw string failure");
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.checkBinary(configs["claude-code"])) as {
      ok: boolean;
      error?: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toBe("raw string failure");
  });

  it("checkAuth (successPattern / claude-code): ok=true when the pattern matches stdout", async () => {
    const execute = vi.fn().mockResolvedValue(
      makeProcessResult({ stdout: '{"loggedIn": true, "user": "ada"}' }),
    );
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.checkAuth(configs["claude-code"])) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("checkAuth (successPattern): ok=false with a snippet of stdout when the pattern does not match", async () => {
    const execute = vi.fn().mockResolvedValue(makeProcessResult({ stdout: '{"loggedIn": false}' }));
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.checkAuth(configs["claude-code"])) as {
      ok: boolean;
      error?: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("expected pattern not found");
    expect(result.error).toContain('"loggedIn": false');
  });

  it("checkAuth (successPattern): also checks stderr for the pattern", async () => {
    const execute = vi.fn().mockResolvedValue(
      makeProcessResult({ stdout: "", stderr: '"loggedIn": true' }),
    );
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.checkAuth(configs["claude-code"])) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("checkAuth: ok=false when the auth probe times out", async () => {
    const execute = vi.fn().mockResolvedValue(makeProcessResult({ timedOut: true }));
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.checkAuth(configs["claude-code"])) as {
      ok: boolean;
      error?: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Auth probe timed out after");
  });

  it("checkAuth (exitCodeOnly / cursor): ok=true on exit code 0 regardless of output", async () => {
    const execute = vi.fn().mockResolvedValue(makeProcessResult({ exitCode: 0, stdout: "anything" }));
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.checkAuth(configs.cursor)) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("checkAuth (exitCodeOnly): ok=false with exit code and stderr/stdout snippet on non-zero exit", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue(makeProcessResult({ exitCode: 1, stderr: "not logged in" }));
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.checkAuth(configs.cursor)) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Exit code 1");
    expect(result.error).toContain("not logged in");
  });

  it("checkAuth (exitCodeOnly): falls back to stdout snippet when stderr is empty", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue(makeProcessResult({ exitCode: 1, stderr: "", stdout: "stdout failure detail" }));
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.checkAuth(configs.cursor)) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("stdout failure detail");
  });

  it("checkAuth (default/codex PONG path): ok=true when exit is 0 and output contains PONG", async () => {
    const execute = vi.fn().mockResolvedValue(makeProcessResult({ exitCode: 0, stdout: "pong" }));
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.checkAuth(configs.codex)) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("checkAuth (default): ok=true when PONG is present even if exit code is non-zero", async () => {
    const execute = vi.fn().mockResolvedValue(makeProcessResult({ exitCode: 1, stdout: "PONG" }));
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.checkAuth(configs.codex)) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("checkAuth (default): ok=false with exit code when non-zero exit and no PONG", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue(makeProcessResult({ exitCode: 1, stderr: "rate limited" }));
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.checkAuth(configs.codex)) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Exit code 1");
    expect(result.error).toContain("rate limited");
  });

  it("checkAuth (default): ok=false with 'did not return expected response' when exit is 0 but no PONG", async () => {
    const execute = vi.fn().mockResolvedValue(makeProcessResult({ exitCode: 0, stdout: "something else" }));
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.checkAuth(configs.codex)) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("did not return expected response");
    expect(result.error).toContain("something else");
  });

  it("checkAuth: ok=false with the error message when execute throws", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("auth probe crashed"));
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.checkAuth(configs.codex)) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe("auth probe crashed");
  });

  it("checkAuth: ok=false with a stringified error when a non-Error is thrown", async () => {
    const execute = vi.fn().mockRejectedValue("raw auth failure");
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.checkAuth(configs.codex)) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe("raw auth failure");
  });

  it("probeRuntime: skips the auth check entirely when the binary check fails", async () => {
    const execute = vi.fn().mockResolvedValue(makeProcessResult({ exitCode: 1, stderr: "no binary" }));
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.probeRuntime("claude-code")) as {
      binaryCheck: { ok: boolean };
      authCheck: { ok: boolean; error?: string };
    };

    expect(result.binaryCheck.ok).toBe(false);
    expect(result.authCheck.ok).toBe(false);
    expect(result.authCheck.error).toBe("Skipped: binary check failed");
    // Only the version-check call should have happened, not an auth-probe call.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("probeRuntime: runs both binary and auth checks when the binary check passes", async () => {
    const execute = vi.fn().mockResolvedValue(makeProcessResult({ exitCode: 0, stdout: "pong" }));
    const { healthCheck, configs } = build(execute);

    const result = (await healthCheck.probeRuntime("codex")) as {
      binaryCheck: { ok: boolean };
      authCheck: { ok: boolean };
    };

    expect(result.binaryCheck.ok).toBe(true);
    expect(result.authCheck.ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

describe("RuntimeHealthCheck.runPreflight()", () => {
  function build(execute: ReturnType<typeof vi.fn>) {
    const processRunner = { execute };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const logger = makeMockLogger();
    const healthCheck = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    return { healthCheck, logger };
  }

  it("resolves ok=true, logs success, and stores the result when all required runtimes pass", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") {
        return makeProcessResult({ stdout: "v1.0.0" });
      }
      // auth probe
      if (opts.command === "claude") {
        return makeProcessResult({ stdout: '{"loggedIn": true}' });
      }
      return makeProcessResult({ stdout: "pong" });
    });
    const { healthCheck, logger } = build(execute);

    const result = await healthCheck.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(healthCheck.getLastResult()).toBe(result);

    expect(logger.info).toHaveBeenCalledWith(
      expect.anything(),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("throws PreflightError and logs failures when a required runtime is not ready", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        return makeProcessResult({ exitCode: 1, stderr: "claude not installed" });
      }
      if (opts.args[0] === "--version") {
        return makeProcessResult({ stdout: "v1.0.0" });
      }
      return makeProcessResult({ stdout: "pong" });
    });
    const { healthCheck, logger } = build(execute);

    await expect(healthCheck.runPreflight()).rejects.toThrow(PreflightError);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ runtime: "claude-code", binaryError: expect.stringContaining("claude not installed") }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );

    // The failed result should still be recorded via getLastResult even though runPreflight threw.
    const lastResult = healthCheck.getLastResult();
    expect(lastResult?.ok).toBe(false);
  });

  it("includes an undefined binaryError/authError for a runtime whose check passed", async () => {
    // One runtime fails on auth only; the other passes both checks entirely,
    // exercising the ternaries that produce `undefined` for a passing check.
    const execute = vi.fn().mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return makeProcessResult({ stdout: "v1.0.0" });
      if (opts.command === "claude") {
        return makeProcessResult({ stdout: '{"loggedIn": false}' });
      }
      return makeProcessResult({ stdout: "pong" });
    });
    const { healthCheck, logger } = build(execute);

    await expect(healthCheck.runPreflight()).rejects.toThrow(PreflightError);

    const errorCall = logger.error.mock.calls.find(
      (c: unknown[]) => c[1] === "Preflight FAILED: one or more agent runtimes are not ready",
    );
    const failures = (errorCall?.[0] as { failures: { runtime: string; binaryError?: string; authError?: string }[] })
      .failures;
    const codexFailure = failures.find((f) => f.runtime === "codex");
    expect(codexFailure).toBeUndefined(); // codex passed both checks fully

    const claudeFailure = failures.find((f) => f.runtime === "claude-code");
    expect(claudeFailure?.binaryError).toBeUndefined();
    expect(claudeFailure?.authError).toContain("expected pattern not found");
  });
});
