import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult, ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function okResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 10, timedOut: false, ...overrides };
}

function makeProcessRunner(
  responder: (options: ProcessSpawnOptions) => ProcessResult | Promise<ProcessResult>,
) {
  return { execute: vi.fn(responder) };
}

// Minimal configs: only claude-code/codex are "required" since AGENT_STAGES never
// routes to "cursor" — but the type requires an entry for every AgentRuntime.
function baseConfigs(overrides: {
  claudeCode?: Partial<Record<string, unknown>>;
  codex?: Partial<Record<string, unknown>>;
}) {
  return {
    "claude-code": {
      command: "claude",
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
      ...overrides.claudeCode,
    },
    codex: {
      command: "codex",
      versionArgs: ["--version"],
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
      ...overrides.codex,
    },
    cursor: {
      command: "agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds config shapes for each runtime from the given commands/args", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "my-claude",
      ["--base"],
      "my-codex",
      ["exec", "-"],
      "my-cursor",
    );

    expect(configs["claude-code"].command).toBe("my-claude");
    expect(configs["claude-code"].versionArgs).toEqual(["--version"]);
    expect(configs["claude-code"].probeArgs).toEqual(["auth", "status"]);
    expect(configs["claude-code"].successPattern).toBe('"loggedIn":\\s*true');

    expect(configs.codex.command).toBe("my-codex");
    expect(configs.codex.probeArgs).toEqual(["exec", "-"]);
    expect(configs.codex.probeStdin).toBe("Respond with exactly: PONG");

    expect(configs.cursor.command).toBe("my-cursor");
    expect(configs.cursor.probeArgs).toEqual(["status"]);
    expect(configs.cursor.exitCodeOnly).toBe(true);
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes / getLastResult", () => {
  it("derives required runtimes from AGENT_STAGES (claude-code and codex, never cursor)", () => {
    const check = new RuntimeHealthCheck(
      makeProcessRunner(() => okResult()) as never,
      baseConfigs({}),
      makeLogger() as never,
    );

    const required = check.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor" as AgentRuntime)).toBe(false);
  });

  it("returns undefined from getLastResult before any preflight has run", () => {
    const check = new RuntimeHealthCheck(
      makeProcessRunner(() => okResult()) as never,
      baseConfigs({}),
      makeLogger() as never,
    );
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight — success path", () => {
  it("resolves ok:true when every required runtime's binary and auth checks pass", async () => {
    const processRunner = makeProcessRunner((options) => {
      if (options.command === "claude") {
        if (options.args[0] === "--version") {
          return okResult({ stdout: "claude-cli v1.2.3\n" });
        }
        return okResult({ stdout: '{"loggedIn": true}' });
      }
      if (options.command === "codex") {
        if (options.args[0] === "--version") {
          return okResult({ stdout: "codex 2.0.0\n" });
        }
        return okResult({ stdout: "PONG" });
      }
      throw new Error(`unexpected command: ${options.command}`);
    });
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs({}), logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);

    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(true);
    expect(claude.binaryCheck.version).toBe("claude-cli v1.2.3");
    expect(claude.authCheck.ok).toBe(true);

    const codex = result.results.find((r) => r.runtime === "codex")!;
    expect(codex.binaryCheck.ok).toBe(true);
    expect(codex.authCheck.ok).toBe(true);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
    expect(check.getLastResult()).toBe(result);
  });
});

describe("RuntimeHealthCheck.runPreflight — failure path", () => {
  it("throws PreflightError when a binary check fails, skips the auth check, and still stores the result", async () => {
    const processRunner = makeProcessRunner((options) => {
      if (options.command === "claude" && options.args[0] === "--version") {
        return okResult({ exitCode: 1, stderr: "command not found", stdout: "" });
      }
      if (options.command === "codex" && options.args[0] === "--version") {
        return okResult({ stdout: "codex 1.0.0" });
      }
      if (options.command === "codex") {
        return okResult({ stdout: "PONG" });
      }
      // claude auth probe should never be reached because binary check failed
      throw new Error("auth probe should have been skipped");
    });
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs({}), logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const lastResult = check.getLastResult();
    expect(lastResult?.ok).toBe(false);
    const claude = lastResult!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(false);
    expect(claude.binaryCheck.error).toContain("command not found");
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toBe("Skipped: binary check failed");
    expect(claude.authCheck.durationMs).toBe(0);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ runtime: "claude-code", authError: "Skipped: binary check failed" }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("throws a PreflightError whose .result carries the full preflight summary", async () => {
    const processRunner = makeProcessRunner((options) =>
      okResult(options.args[0] === "--version" ? { exitCode: 1 } : {}),
    );
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs({}), makeLogger() as never);

    try {
      await check.runPreflight();
      throw new Error("expected runPreflight to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightError);
      const e = err as PreflightError;
      expect(e.result.ok).toBe(false);
      expect(e.message).toContain("Preflight failed for runtimes");
    }
  });
});

describe("RuntimeHealthCheck — binary-check branches", () => {
  it("marks binaryCheck failed with a timeout message when the version probe times out", async () => {
    const processRunner = makeProcessRunner((options) => {
      if (options.command === "claude" && options.args[0] === "--version") {
        return okResult({ timedOut: true });
      }
      if (options.args[0] === "--version") return okResult({ stdout: "codex 1.0" });
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs({}), makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(false);
    expect(claude.binaryCheck.error).toBe("Timed out after 5000ms");
  });

  it("marks binaryCheck failed with the caught error's message when execute() rejects", async () => {
    const processRunner = makeProcessRunner((options) => {
      if (options.command === "claude" && options.args[0] === "--version") {
        return Promise.reject(new Error("ENOENT: spawn claude"));
      }
      if (options.args[0] === "--version") return okResult({ stdout: "codex 1.0" });
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs({}), makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(false);
    expect(claude.binaryCheck.error).toBe("ENOENT: spawn claude");
  });

  it("stringifies a non-Error value thrown while checking the binary", async () => {
    const processRunner = makeProcessRunner((options) => {
      if (options.command === "claude" && options.args[0] === "--version") {
        return Promise.reject("not an Error instance");
      }
      if (options.args[0] === "--version") return okResult({ stdout: "codex 1.0" });
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs({}), makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(false);
    expect(claude.binaryCheck.error).toBe("not an Error instance");
  });
});

describe("RuntimeHealthCheck — auth-check branches", () => {
  it("fails auth with a timeout message when the auth probe times out", async () => {
    const processRunner = makeProcessRunner((options) => {
      if (options.args[0] === "--version") return okResult({ stdout: "v1" });
      if (options.command === "claude") return okResult({ timedOut: true });
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs({}), makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toBe("Auth probe timed out after 30000ms");
  });

  it("fails auth when a successPattern is configured but the probe output doesn't match", async () => {
    const processRunner = makeProcessRunner((options) => {
      if (options.args[0] === "--version") return okResult({ stdout: "v1" });
      if (options.command === "claude") return okResult({ stdout: '{"loggedIn": false}' });
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs({}), makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toContain("Auth check failed: expected pattern not found");
    expect(claude.authCheck.error).toContain('"loggedIn": false');
  });

  it("passes auth when exitCodeOnly is set and the probe exits 0", async () => {
    const processRunner = makeProcessRunner((options) => {
      if (options.args[0] === "--version") return okResult({ stdout: "v1" });
      return okResult({ exitCode: 0 });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      baseConfigs({ codex: { successPattern: undefined, exitCodeOnly: true } }),
      makeLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError); // claude-code still uses pattern & fails (no loggedIn in stdout)
    const codex = check.getLastResult()!.results.find((r) => r.runtime === "codex")!;
    expect(codex.authCheck.ok).toBe(true);
  });

  it("fails auth when exitCodeOnly is set and the probe exits non-zero", async () => {
    const processRunner = makeProcessRunner((options) => {
      if (options.args[0] === "--version") return okResult({ stdout: "v1" });
      if (options.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ exitCode: 7, stderr: "not logged in" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      baseConfigs({ codex: { successPattern: undefined, exitCodeOnly: true } }),
      makeLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codex = check.getLastResult()!.results.find((r) => r.runtime === "codex")!;
    expect(codex.authCheck.ok).toBe(false);
    expect(codex.authCheck.error).toContain("Exit code 7");
    expect(codex.authCheck.error).toContain("not logged in");
  });

  it("passes auth via the default PONG check even when exit code is non-zero, as long as output contains 'pong'", async () => {
    const processRunner = makeProcessRunner((options) => {
      if (options.args[0] === "--version") return okResult({ stdout: "v1" });
      if (options.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ exitCode: 1, stdout: "PONG received", stderr: "warn: deprecated" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      baseConfigs({ codex: { successPattern: undefined } }),
      makeLogger() as never,
    );

    const result = await check.runPreflight();
    const codex = result.results.find((r) => r.runtime === "codex")!;
    expect(codex.authCheck.ok).toBe(true);
  });

  it("fails the default PONG check with an exit-code message when exit is non-zero and no pong is present", async () => {
    const processRunner = makeProcessRunner((options) => {
      if (options.args[0] === "--version") return okResult({ stdout: "v1" });
      if (options.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ exitCode: 2, stdout: "nothing useful", stderr: "boom" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      baseConfigs({ codex: { successPattern: undefined } }),
      makeLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codex = check.getLastResult()!.results.find((r) => r.runtime === "codex")!;
    expect(codex.authCheck.ok).toBe(false);
    expect(codex.authCheck.error).toContain("Exit code 2");
    expect(codex.authCheck.error).toContain("boom");
  });

  it("fails the default PONG check with 'did not return expected response' when exit is 0 but no pong is present", async () => {
    const processRunner = makeProcessRunner((options) => {
      if (options.args[0] === "--version") return okResult({ stdout: "v1" });
      if (options.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ exitCode: 0, stdout: "all good, no magic word" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      baseConfigs({ codex: { successPattern: undefined } }),
      makeLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codex = check.getLastResult()!.results.find((r) => r.runtime === "codex")!;
    expect(codex.authCheck.ok).toBe(false);
    expect(codex.authCheck.error).toContain("Auth probe did not return expected response");
  });

  it("falls back to stdout in the exitCodeOnly error message when stderr is empty", async () => {
    const processRunner = makeProcessRunner((options) => {
      if (options.args[0] === "--version") return okResult({ stdout: "v1" });
      if (options.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ exitCode: 9, stderr: "", stdout: "printed to stdout instead" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      baseConfigs({ codex: { successPattern: undefined, exitCodeOnly: true } }),
      makeLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codex = check.getLastResult()!.results.find((r) => r.runtime === "codex")!;
    expect(codex.authCheck.ok).toBe(false);
    expect(codex.authCheck.error).toContain("Exit code 9");
    expect(codex.authCheck.error).toContain("printed to stdout instead");
  });

  it("stringifies a non-Error value thrown while checking auth", async () => {
    const processRunner = makeProcessRunner((options) => {
      if (options.args[0] === "--version") return okResult({ stdout: "v1" });
      if (options.command === "claude") return Promise.reject("just a plain string failure");
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs({}), makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toBe("just a plain string failure");
  });

  it("marks authCheck failed with the caught error's message when execute() rejects during the probe", async () => {
    const processRunner = makeProcessRunner((options) => {
      if (options.args[0] === "--version") return okResult({ stdout: "v1" });
      if (options.command === "claude") return Promise.reject(new Error("socket hang up"));
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs({}), makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toBe("socket hang up");
  });
});
