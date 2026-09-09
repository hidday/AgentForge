import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeProcessRunner() {
  return { execute: vi.fn() };
}

function okResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 5, timedOut: false, ...overrides };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds per-runtime configs with the expected shape", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--print"],
      "codex",
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
      command: "codex",
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

describe("RuntimeHealthCheck.getRequiredRuntimes / getLastResult", () => {
  it("derives required runtimes from AGENT_STAGES (claude-code and codex, not cursor)", () => {
    const processRunner = makeProcessRunner();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent");
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    const required = check.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });

  it("getLastResult() is undefined before any preflight has run", () => {
    const processRunner = makeProcessRunner();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent");
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight", () => {
  it("passes and records skippedRuntimes when all required runtimes are healthy", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "v1.2.3\n" });
      if (opts.args[0] === "auth") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ stdout: "PONG" });
    });
    const logger = makeLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"].sort());
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(check.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("throws PreflightError and logs failures when a runtime is not ready", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude") {
        if (opts.args[0] === "--version") return okResult({ stdout: "v1.0.0" });
        return okResult({ stdout: '{"loggedIn": false}' });
      }
      // codex fails at the binary check stage
      return okResult({ exitCode: 1, stderr: "command not found" });
    });
    const logger = makeLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([expect.objectContaining({ runtime: "codex" })]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
    // lastResult reflects the failed run even though runPreflight() threw
    expect(check.getLastResult()?.ok).toBe(false);
  });
});

describe("RuntimeHealthCheck private probe behaviour (via runPreflight)", () => {
  const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");

  it("skips the auth check when the binary check fails", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        return okResult({ exitCode: 1, stderr: "not found" });
      }
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    expect(caught).toBeInstanceOf(PreflightError);
    const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.ok).toBe(false);
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toBe("Skipped: binary check failed");
    expect(claudeResult.authCheck.durationMs).toBe(0);

    // Only ONE call for claude (the version check) -- auth probe args never used.
    const claudeCalls = processRunner.execute.mock.calls.filter(
      (c) => (c[0] as { command: string }).command === "claude",
    );
    expect(claudeCalls).toHaveLength(1);
  });

  it("checkBinary: marks timedOut result as failed with a timeout message", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        return okResult({ timedOut: true });
      }
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.ok).toBe(false);
    expect(claudeResult.binaryCheck.error).toContain("Timed out after");
  });

  it("checkBinary: catches a thrown error from processRunner.execute", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        throw new Error("spawn ENOENT");
      }
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.ok).toBe(false);
    expect(claudeResult.binaryCheck.error).toBe("spawn ENOENT");
  });

  it("checkBinary: extracts the first line of stdout as the version, ignoring later lines", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "  v9.9.9\nextra line\n" });
      if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    const result = await check.runPreflight();
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.version).toBe("v9.9.9");
  });

  it("checkBinary: caps the extracted version string at 100 characters", async () => {
    const processRunner = makeProcessRunner();
    const longVersion = "v".repeat(150);
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: longVersion });
      if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    const result = await check.runPreflight();
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.version).toHaveLength(100);
  });

  it("checkAuth (successPattern): fails with a diagnostic message when the pattern does not match", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "v1" });
      if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": false}' });
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toContain("expected pattern not found");
  });

  it("checkAuth (successPattern): matches against combined stdout when pattern is present", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "v1" });
      if (opts.command === "claude") return okResult({ stdout: '{"loggedIn":   true}' });
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    const result = await check.runPreflight();
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(true);
  });

  it("checkAuth: times out and reports a timeout-specific error", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "v1" });
      if (opts.command === "claude") return okResult({ timedOut: true });
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toContain("Auth probe timed out after");
  });

  it("checkAuth: catches a thrown error from processRunner.execute during the auth probe", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "v1" });
      if (opts.command === "claude") throw new Error("auth probe crashed");
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toBe("auth probe crashed");
  });

  it("checkAuth (exitCodeOnly): a codex-like config using exitCodeOnly passes on exit 0", async () => {
    // Build a config set where codex itself uses exitCodeOnly to exercise that branch
    // (the default codex config uses the PONG-echo branch instead).
    const exitCodeOnlyConfigs = {
      ...configs,
      codex: { ...configs.codex, exitCodeOnly: true, successPattern: undefined },
    };
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "v1" });
      if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ exitCode: 0, stdout: "irrelevant output" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      exitCodeOnlyConfigs as never,
      makeLogger() as never,
    );

    const result = await check.runPreflight();
    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(true);
  });

  it("checkAuth (exitCodeOnly): falls back to stdout in the diagnostic when stderr is empty", async () => {
    const exitCodeOnlyConfigs = {
      ...configs,
      codex: { ...configs.codex, exitCodeOnly: true, successPattern: undefined },
    };
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "v1" });
      if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ exitCode: 5, stdout: "stdout-only failure detail", stderr: "" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      exitCodeOnlyConfigs as never,
      makeLogger() as never,
    );

    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    const codexResult = caught!.result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.error).toContain("stdout-only failure detail");
  });

  it("checkAuth (exitCodeOnly): fails with exit-code diagnostic on non-zero exit", async () => {
    const exitCodeOnlyConfigs = {
      ...configs,
      codex: { ...configs.codex, exitCodeOnly: true, successPattern: undefined },
    };
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "v1" });
      if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ exitCode: 3, stderr: "boom" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      exitCodeOnlyConfigs as never,
      makeLogger() as never,
    );

    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    const codexResult = caught!.result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(false);
    expect(codexResult.authCheck.error).toContain("Exit code 3");
  });

  it("checkAuth (pong fallback): passes when PONG appears in stdout with exit code 0", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "v1" });
      if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ exitCode: 0, stdout: "sure, PONG" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    const result = await check.runPreflight();
    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(true);
  });

  it("checkAuth (pong fallback): passes when PONG is present even with a non-zero exit code", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "v1" });
      if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ exitCode: 1, stdout: "PONG", stderr: "warning" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    const result = await check.runPreflight();
    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(true);
  });

  it("checkAuth (pong fallback): fails with exit-code diagnostic on non-zero exit with no PONG", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "v1" });
      if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ exitCode: 2, stdout: "nope", stderr: "totally broken" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    const codexResult = caught!.result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(false);
    expect(codexResult.authCheck.error).toContain("Exit code 2");
  });

  it("checkBinary: stringifies a thrown non-Error value", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "raw string failure";
      }
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.error).toBe("raw string failure");
  });

  it("checkAuth: stringifies a thrown non-Error value", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "v1" });
      if (opts.command === "claude") {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "raw auth failure";
      }
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.error).toBe("raw auth failure");
  });

  it("checkAuth (pong fallback): fails with a generic diagnostic when exit is 0 but no PONG found", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "v1" });
      if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ exitCode: 0, stdout: "hello there" });
    });
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    const codexResult = caught!.result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(false);
    expect(codexResult.authCheck.error).toContain("did not return expected response");
  });
});
