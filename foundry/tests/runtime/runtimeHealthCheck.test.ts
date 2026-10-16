import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck, type RuntimeProbeResult } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeProcessRunnerStub() {
  return { execute: vi.fn() };
}

function result(partial: Partial<ProcessResult>): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 1, timedOut: false, ...partial };
}

// Accessor for the class's private methods, used to unit-test each branch of
// checkBinary/checkAuth/probeRuntime directly without having to orchestrate a
// full runPreflight() call (which races required runtimes concurrently).
interface RuntimeHealthCheckInternals {
  checkBinary(config: Record<string, unknown>): Promise<RuntimeProbeResult["binaryCheck"]>;
  checkAuth(config: Record<string, unknown>): Promise<RuntimeProbeResult["authCheck"]>;
  probeRuntime(runtime: string): Promise<RuntimeProbeResult>;
}

function asInternals(runner: RuntimeHealthCheck): RuntimeHealthCheckInternals {
  return runner as unknown as RuntimeHealthCheckInternals;
}

describe("RuntimeHealthCheck.buildRuntimeConfigs()", () => {
  it("builds the expected probe configuration for each runtime", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--print"],
      "codex-cli",
      ["exec", "-"],
      "agent",
    );

    expect(configs["claude-code"]).toMatchObject({
      command: "claude",
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });
    expect(configs.codex).toMatchObject({
      command: "codex-cli",
      versionArgs: ["--version"],
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });
    expect(configs.cursor).toMatchObject({
      command: "agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes()", () => {
  it("derives the required set from AGENT_STAGES (claude-code and codex, not cursor)", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent");
    const runner = new RuntimeHealthCheck(
      makeProcessRunnerStub() as never,
      configs,
      makeLogger() as never,
    );

    const required = runner.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });
});

describe("RuntimeHealthCheck.getLastResult()", () => {
  it("is undefined until a preflight has run", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent");
    const runner = new RuntimeHealthCheck(
      makeProcessRunnerStub() as never,
      configs,
      makeLogger() as never,
    );
    expect(runner.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck — checkBinary() branches", () => {
  const config = { command: "claude", versionArgs: ["--version"], probeArgs: ["auth", "status"] };

  it("returns ok:true with a truncated, trimmed first line as the version", async () => {
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockResolvedValue(
      result({ stdout: `  v1.2.3 ${"x".repeat(200)}\nsecond line\n`, exitCode: 0 }),
    );
    const runner = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": config } as never,
      makeLogger() as never,
    );

    const check = await asInternals(runner).checkBinary(config);

    expect(check.ok).toBe(true);
    expect(check.version).toHaveLength(100);
    expect(check.version?.startsWith("v1.2.3")).toBe(true);
    expect(typeof check.durationMs).toBe("number");
  });

  it("returns ok:false with a timeout message when the probe times out", async () => {
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockResolvedValue(result({ timedOut: true }));
    const runner = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": config } as never,
      makeLogger() as never,
    );
    const check = await asInternals(runner).checkBinary(config);
    expect(check.ok).toBe(false);
    expect(check.error).toBe("Timed out after 5000ms");
  });

  it("returns ok:false with the exit code and truncated stderr on a non-zero exit", async () => {
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockResolvedValue(
      result({ exitCode: 127, stderr: "command not found" }),
    );
    const runner = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": config } as never,
      makeLogger() as never,
    );
    const check = await asInternals(runner).checkBinary(config);
    expect(check.ok).toBe(false);
    expect(check.error).toBe("Exit code 127: command not found");
  });

  it("returns ok:false with the error message when execute throws", async () => {
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockRejectedValue(new Error("ENOENT: claude not found"));
    const runner = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": config } as never,
      makeLogger() as never,
    );
    const check = await asInternals(runner).checkBinary(config);
    expect(check.ok).toBe(false);
    expect(check.error).toBe("ENOENT: claude not found");
  });

  it("falls back to String(err) when execute throws a non-Error value", async () => {
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockRejectedValue("raw string failure");
    const runner = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": config } as never,
      makeLogger() as never,
    );
    const check = await asInternals(runner).checkBinary(config);
    expect(check.ok).toBe(false);
    expect(check.error).toBe("raw string failure");
  });
});

describe("RuntimeHealthCheck — checkAuth() branches", () => {
  async function callCheckAuth(
    processRunner: { execute: ReturnType<typeof vi.fn> },
    config: Record<string, unknown>,
  ) {
    const runner = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": config } as never,
      makeLogger() as never,
    );
    return asInternals(runner).checkAuth(config);
  }

  it("successPattern: ok:true when the pattern matches stdout", async () => {
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockResolvedValue(result({ stdout: '{"loggedIn": true}', exitCode: 0 }));
    const check = await callCheckAuth(processRunner, {
      command: "claude",
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });
    expect(check.ok).toBe(true);
  });

  it("successPattern: ok:false with a descriptive error when the pattern does not match", async () => {
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockResolvedValue(
      result({ stdout: '{"loggedIn": false}', exitCode: 0 }),
    );
    const check = await callCheckAuth(processRunner, {
      command: "claude",
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });
    expect(check.ok).toBe(false);
    expect(check.error).toContain("expected pattern not found");
    expect(check.error).toContain('{"loggedIn": false}');
  });

  it("returns ok:false with a timeout message when the auth probe times out", async () => {
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockResolvedValue(result({ timedOut: true }));
    const check = await callCheckAuth(processRunner, {
      command: "claude",
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });
    expect(check.ok).toBe(false);
    expect(check.error).toBe("Auth probe timed out after 30000ms");
  });

  it("exitCodeOnly: ok:true on exit code 0", async () => {
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockResolvedValue(result({ exitCode: 0 }));
    const check = await callCheckAuth(processRunner, {
      command: "agent",
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
    expect(check.ok).toBe(true);
  });

  it("exitCodeOnly: ok:false with the exit code and output on non-zero exit", async () => {
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockResolvedValue(
      result({ exitCode: 1, stderr: "", stdout: "not logged in" }),
    );
    const check = await callCheckAuth(processRunner, {
      command: "agent",
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
    expect(check.ok).toBe(false);
    expect(check.error).toBe("Exit code 1: not logged in");
  });

  it("pong-style probe: ok:true when PONG appears even on a non-zero exit code", async () => {
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockResolvedValue(result({ exitCode: 1, stdout: "PONG" }));
    const check = await callCheckAuth(processRunner, {
      command: "codex",
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });
    expect(check.ok).toBe(true);
  });

  it("pong-style probe: ok:false with exit code details when there's no PONG and exit is non-zero", async () => {
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockResolvedValue(
      result({ exitCode: 1, stderr: "auth required", stdout: "" }),
    );
    const check = await callCheckAuth(processRunner, {
      command: "codex",
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });
    expect(check.ok).toBe(false);
    expect(check.error).toBe("Exit code 1: auth required");
  });

  it("pong-style probe: ok:false with an unexpected-response message on exit 0 with no PONG", async () => {
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockResolvedValue(result({ exitCode: 0, stdout: "hello there" }));
    const check = await callCheckAuth(processRunner, {
      command: "codex",
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });
    expect(check.ok).toBe(false);
    expect(check.error).toContain("Auth probe did not return expected response");
    expect(check.error).toContain("hello there");
  });

  it("pong-style probe: ok:true on exit 0 with PONG present", async () => {
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockResolvedValue(result({ exitCode: 0, stdout: "pong" }));
    const check = await callCheckAuth(processRunner, {
      command: "codex",
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });
    expect(check.ok).toBe(true);
  });

  it("returns ok:false with the error message when execute throws", async () => {
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockRejectedValue(new Error("probe crashed"));
    const check = await callCheckAuth(processRunner, {
      command: "codex",
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });
    expect(check.ok).toBe(false);
    expect(check.error).toBe("probe crashed");
  });

  it("falls back to String(err) when execute throws a non-Error value", async () => {
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockRejectedValue("raw auth failure");
    const check = await callCheckAuth(processRunner, {
      command: "codex",
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });
    expect(check.ok).toBe(false);
    expect(check.error).toBe("raw auth failure");
  });
});

describe("RuntimeHealthCheck — probeRuntime() short-circuiting", () => {
  it("skips the auth check entirely when the binary check fails", async () => {
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockResolvedValue(result({ exitCode: 1, stderr: "not found" }));
    const config = { command: "claude", versionArgs: ["--version"], probeArgs: ["auth", "status"] };
    const runner = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": config } as never,
      makeLogger() as never,
    );

    const probe = await asInternals(runner).probeRuntime("claude-code");

    expect(probe.binaryCheck.ok).toBe(false);
    expect(probe.authCheck.ok).toBe(false);
    expect(probe.authCheck.error).toBe("Skipped: binary check failed");
    // Only the version-check call happened; the auth probe never ran.
    expect(processRunner.execute).toHaveBeenCalledTimes(1);
  });

  it("runs both checks when the binary check succeeds", async () => {
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockResolvedValue(result({ exitCode: 0, stdout: "PONG v1" }));
    const config = { command: "claude", versionArgs: ["--version"], probeArgs: ["auth", "status"] };
    const runner = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": config } as never,
      makeLogger() as never,
    );

    const probe = await asInternals(runner).probeRuntime("claude-code");

    expect(probe.binaryCheck.ok).toBe(true);
    expect(probe.authCheck.ok).toBe(true);
    expect(processRunner.execute).toHaveBeenCalledTimes(2);
  });
});

describe("RuntimeHealthCheck.runPreflight()", () => {
  it("resolves with ok:true, lists skipped runtimes, and logs success when every required runtime is healthy", async () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex-cli", [], "agent");
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockImplementation(async (opts: { command: string }) => {
      if (opts.command === "claude") {
        return result({ exitCode: 0, stdout: '{"loggedIn": true}' });
      }
      if (opts.command === "codex-cli") {
        return result({ exitCode: 0, stdout: "PONG" });
      }
      throw new Error(`unexpected command ${opts.command}`);
    });
    const logger = makeLogger();
    const runner = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const preflight = await runner.runPreflight();

    expect(preflight.ok).toBe(true);
    expect(preflight.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(preflight.skippedRuntimes).toEqual(["cursor"]);
    expect(preflight.results).toHaveLength(2);
    expect(typeof preflight.totalDurationMs).toBe("number");
    expect(runner.getLastResult()).toBe(preflight);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("throws PreflightError, logs failures, and still records getLastResult() when a runtime is unhealthy", async () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex-cli", [], "agent");
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockImplementation(
      async (opts: { command: string; args: string[] }) => {
        const isVersionCheck = opts.args.includes("--version");
        if (opts.command === "claude") {
          return isVersionCheck
            ? result({ exitCode: 0, stdout: "1.0.0" })
            : result({ exitCode: 0, stdout: '{"loggedIn": true}' });
        }
        if (opts.command === "codex-cli") {
          return isVersionCheck
            ? result({ exitCode: 0, stdout: "2.0.0" })
            : result({ exitCode: 1, stderr: "codex not authenticated" });
        }
        throw new Error(`unexpected command ${opts.command}`);
      },
    );
    const logger = makeLogger();
    const runner = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(runner.runPreflight()).rejects.toThrow(PreflightError);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({
            runtime: "codex",
            authError: "Exit code 1: codex not authenticated",
          }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );

    const lastResult = runner.getLastResult();
    expect(lastResult?.ok).toBe(false);
  });

  it("the thrown PreflightError carries the full preflight result for callers to inspect", async () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex-cli", [], "agent");
    const processRunner = makeProcessRunnerStub();
    processRunner.execute.mockResolvedValue(result({ exitCode: 1, stderr: "boom" }));
    const runner = new RuntimeHealthCheck(
      processRunner as never,
      configs,
      makeLogger() as never,
    );

    try {
      await runner.runPreflight();
      throw new Error("expected runPreflight to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightError);
      const preflightErr = err as PreflightError;
      expect(preflightErr.result.ok).toBe(false);
      expect(preflightErr.result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    }
  });
});
