import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult, ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function pr(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 10, timedOut: false, ...overrides };
}

function buildConfigs() {
  return RuntimeHealthCheck.buildRuntimeConfigs(
    "claude-mock",
    [],
    "codex-mock",
    ["exec", "-"],
    "cursor-mock",
  );
}

/** Routes execute() calls by command + whether it's the --version probe or the auth probe. */
function makeRoutedExecute(
  handlers: Record<string, (isVersionCall: boolean, opts: ProcessSpawnOptions) => ProcessResult | Promise<ProcessResult>>,
) {
  return vi.fn(async (opts: ProcessSpawnOptions) => {
    const handler = handlers[opts.command];
    if (!handler) throw new Error(`unexpected command: ${opts.command}`);
    const isVersionCall = opts.args.length === 1 && opts.args[0] === "--version";
    return handler(isVersionCall, opts);
  });
}

describe("RuntimeHealthCheck.buildRuntimeConfigs()", () => {
  it("builds distinct configs per runtime with their expected probe shapes", () => {
    const configs = buildConfigs();

    expect(configs["claude-code"]).toMatchObject({
      command: "claude-mock",
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });
    expect(configs.codex).toMatchObject({
      command: "codex-mock",
      versionArgs: ["--version"],
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });
    expect(configs.cursor).toMatchObject({
      command: "cursor-mock",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes() / getLastResult()", () => {
  it("derives the required runtime set from AGENT_STAGES (cursor is unused and thus not required)", () => {
    const check = new RuntimeHealthCheck({ execute: vi.fn() } as never, buildConfigs(), makeMockLogger() as never);
    const required = check.getRequiredRuntimes();
    expect(required).toEqual(new Set(["claude-code", "codex"]));
  });

  it("returns undefined from getLastResult() before runPreflight() has ever run", () => {
    const check = new RuntimeHealthCheck({ execute: vi.fn() } as never, buildConfigs(), makeMockLogger() as never);
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight() — overall pass/fail", () => {
  it("resolves ok:true, lists cursor as skipped, and caches the result when all required runtimes pass", async () => {
    const execute = makeRoutedExecute({
      "claude-mock": (isVersion) =>
        isVersion ? pr({ stdout: "1.2.3" }) : pr({ stdout: '{"loggedIn": true}' }),
      "codex-mock": (isVersion) => (isVersion ? pr({ stdout: "0.9.0" }) : pr({ stdout: "PONG" })),
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck({ execute } as never, buildConfigs(), logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect([...result.requiredRuntimes].sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(check.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("throws PreflightError, skips the auth probe, and logs the failure when the binary check fails", async () => {
    const execute = makeRoutedExecute({
      "claude-mock": (isVersion) =>
        isVersion ? pr({ exitCode: 127, stderr: "command not found" }) : pr({ stdout: "unreachable" }),
      "codex-mock": (isVersion) => (isVersion ? pr({ stdout: "0.9.0" }) : pr({ stdout: "PONG" })),
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck({ execute } as never, buildConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const claudeCalls = execute.mock.calls.filter(([o]) => o.command === "claude-mock");
    expect(claudeCalls).toHaveLength(1); // auth probe was skipped entirely

    const result = check.getLastResult();
    expect(result?.ok).toBe(false);
    const claudeResult = result?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toContain("command not found");
    expect(claudeResult?.authCheck).toEqual({
      ok: false,
      durationMs: 0,
      error: "Skipped: binary check failed",
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ runtime: "claude-code" }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("fails preflight when the binary check passes but the auth check fails", async () => {
    const execute = makeRoutedExecute({
      "claude-mock": (isVersion) =>
        isVersion ? pr({ stdout: "1.2.3" }) : pr({ stdout: '{"loggedIn": false}' }),
      "codex-mock": (isVersion) => (isVersion ? pr({ stdout: "0.9.0" }) : pr({ stdout: "PONG" })),
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck({ execute } as never, buildConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult();
    const claudeResult = result?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(true);
    expect(claudeResult?.authCheck.ok).toBe(false);
  });
});

describe("RuntimeHealthCheck — checkBinary() branches", () => {
  it("fails the binary check with a timeout message when the version probe times out", async () => {
    const execute = makeRoutedExecute({
      "claude-mock": (isVersion) => (isVersion ? pr({ timedOut: true }) : pr({ stdout: "PONG" })),
      "codex-mock": (isVersion) => (isVersion ? pr({ stdout: "0.9.0" }) : pr({ stdout: "PONG" })),
    });
    const check = new RuntimeHealthCheck({ execute } as never, buildConfigs(), makeMockLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toBe("Timed out after 5000ms");
  });

  it("captures the thrown error message when execute() rejects during the binary check", async () => {
    const execute = makeRoutedExecute({
      "claude-mock": (isVersion) => {
        if (isVersion) throw new Error("spawn claude-mock ENOENT");
        return pr({ stdout: "PONG" });
      },
      "codex-mock": (isVersion) => (isVersion ? pr({ stdout: "0.9.0" }) : pr({ stdout: "PONG" })),
    });
    const check = new RuntimeHealthCheck({ execute } as never, buildConfigs(), makeMockLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toBe("spawn claude-mock ENOENT");
  });

  it("extracts only the first line of stdout (truncated to 100 chars) as the version string", async () => {
    const execute = makeRoutedExecute({
      "claude-mock": (isVersion) =>
        isVersion ? pr({ stdout: "1.2.3\nextra line that should be ignored" }) : pr({ stdout: '{"loggedIn": true}' }),
      "codex-mock": (isVersion) => (isVersion ? pr({ stdout: "0.9.0" }) : pr({ stdout: "PONG" })),
    });
    const check = new RuntimeHealthCheck({ execute } as never, buildConfigs(), makeMockLogger() as never);

    const result = await check.runPreflight();
    const claudeResult = result.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.version).toBe("1.2.3");
  });
});

describe("RuntimeHealthCheck — checkAuth() branches", () => {
  it("fails with 'expected pattern not found' when successPattern does not match the probe output", async () => {
    const execute = makeRoutedExecute({
      "claude-mock": (isVersion) =>
        isVersion ? pr({ stdout: "1.2.3" }) : pr({ stdout: '{"loggedIn": false}' }),
      "codex-mock": (isVersion) => (isVersion ? pr({ stdout: "0.9.0" }) : pr({ stdout: "PONG" })),
    });
    const check = new RuntimeHealthCheck({ execute } as never, buildConfigs(), makeMockLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.error).toContain("expected pattern not found in output");
  });

  it("fails with a timeout message when the auth probe times out (PROBE_TIMEOUT_MS)", async () => {
    const execute = makeRoutedExecute({
      "claude-mock": (isVersion) => (isVersion ? pr({ stdout: "1.2.3" }) : pr({ timedOut: true })),
      "codex-mock": (isVersion) => (isVersion ? pr({ stdout: "0.9.0" }) : pr({ stdout: "PONG" })),
    });
    const check = new RuntimeHealthCheck({ execute } as never, buildConfigs(), makeMockLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.error).toBe("Auth probe timed out after 30000ms");
  });

  it("captures the thrown error message when execute() rejects during the auth check", async () => {
    const execute = makeRoutedExecute({
      "claude-mock": (isVersion) => {
        if (isVersion) return pr({ stdout: "1.2.3" });
        throw new Error("probe connection reset");
      },
      "codex-mock": (isVersion) => (isVersion ? pr({ stdout: "0.9.0" }) : pr({ stdout: "PONG" })),
    });
    const check = new RuntimeHealthCheck({ execute } as never, buildConfigs(), makeMockLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.error).toBe("probe connection reset");
  });

  it("fails exitCodeOnly auth checks on non-zero exit, and passes on exit code 0", async () => {
    // Temporarily reconfigure codex (a required runtime) to use the exitCodeOnly
    // strategy so we can drive that branch of checkAuth() through runPreflight().
    const configs = buildConfigs();
    configs.codex = { ...configs.codex, successPattern: undefined, exitCodeOnly: true } as never;

    const failingExecute = makeRoutedExecute({
      "claude-mock": (isVersion) =>
        isVersion ? pr({ stdout: "1.2.3" }) : pr({ stdout: '{"loggedIn": true}' }),
      "codex-mock": (isVersion) => (isVersion ? pr({ stdout: "0.9.0" }) : pr({ exitCode: 3, stderr: "denied" })),
    });
    const checkFail = new RuntimeHealthCheck({ execute: failingExecute } as never, configs, makeMockLogger() as never);
    await expect(checkFail.runPreflight()).rejects.toThrow(PreflightError);
    const codexFail = checkFail.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexFail?.authCheck.ok).toBe(false);
    expect(codexFail?.authCheck.error).toContain("Exit code 3");
    expect(codexFail?.authCheck.error).toContain("denied");

    const passingExecute = makeRoutedExecute({
      "claude-mock": (isVersion) =>
        isVersion ? pr({ stdout: "1.2.3" }) : pr({ stdout: '{"loggedIn": true}' }),
      "codex-mock": (isVersion) => (isVersion ? pr({ stdout: "0.9.0" }) : pr({ exitCode: 0 })),
    });
    const checkPass = new RuntimeHealthCheck({ execute: passingExecute } as never, configs, makeMockLogger() as never);
    const passResult = await checkPass.runPreflight();
    const codexPass = passResult.results.find((r) => r.runtime === "codex");
    expect(codexPass?.authCheck.ok).toBe(true);
  });

  it("the default (pong) auth check: fails without a PONG on non-zero exit, fails without PONG even on exit 0, and passes when PONG is present despite a non-zero exit", async () => {
    const baseClaude = (isVersion: boolean) =>
      isVersion ? pr({ stdout: "1.2.3" }) : pr({ stdout: '{"loggedIn": true}' });

    const failNoPongNonZero = makeRoutedExecute({
      "claude-mock": baseClaude,
      "codex-mock": (isVersion) =>
        isVersion ? pr({ stdout: "0.9.0" }) : pr({ exitCode: 1, stderr: "connection refused" }),
    });
    const check1 = new RuntimeHealthCheck({ execute: failNoPongNonZero } as never, buildConfigs(), makeMockLogger() as never);
    await expect(check1.runPreflight()).rejects.toThrow(PreflightError);
    const codex1 = check1.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codex1?.authCheck.ok).toBe(false);
    expect(codex1?.authCheck.error).toContain("Exit code 1");
    expect(codex1?.authCheck.error).toContain("connection refused");

    const failNoPongZeroExit = makeRoutedExecute({
      "claude-mock": baseClaude,
      "codex-mock": (isVersion) => (isVersion ? pr({ stdout: "0.9.0" }) : pr({ exitCode: 0, stdout: "all good" })),
    });
    const check2 = new RuntimeHealthCheck({ execute: failNoPongZeroExit } as never, buildConfigs(), makeMockLogger() as never);
    await expect(check2.runPreflight()).rejects.toThrow(PreflightError);
    const codex2 = check2.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codex2?.authCheck.ok).toBe(false);
    expect(codex2?.authCheck.error).toContain("did not return expected response");

    const passPongDespiteNonZero = makeRoutedExecute({
      "claude-mock": baseClaude,
      "codex-mock": (isVersion) =>
        isVersion ? pr({ stdout: "0.9.0" }) : pr({ exitCode: 1, stdout: "pong" }),
    });
    const check3 = new RuntimeHealthCheck({ execute: passPongDespiteNonZero } as never, buildConfigs(), makeMockLogger() as never);
    const result3 = await check3.runPreflight();
    const codex3 = result3.results.find((r) => r.runtime === "codex");
    expect(codex3?.authCheck.ok).toBe(true);
  });
});
