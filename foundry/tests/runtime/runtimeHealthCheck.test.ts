import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function result(overrides: Partial<ProcessResult>): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 5, timedOut: false, ...overrides };
}

/** The two runtimes actually required by AGENT_STAGES (claude-code, codex); cursor is unused. */
type Configs = Record<
  AgentRuntime,
  {
    command: string;
    versionArgs: string[];
    probeArgs: string[];
    probeStdin?: string;
    successPattern?: string;
    exitCodeOnly?: boolean;
  }
>;

const healthyClaudeConfig = {
  command: "claude",
  versionArgs: ["--version"],
  probeArgs: ["auth", "status"],
  successPattern: '"loggedIn":\\s*true',
};

const healthyCodexConfig = {
  command: "codex",
  versionArgs: ["--version"],
  probeArgs: ["exec", "-"],
  probeStdin: "Respond with exactly: PONG",
};

function baseConfigs(overrides: Partial<Configs> = {}): Configs {
  return {
    "claude-code": healthyClaudeConfig,
    codex: healthyCodexConfig,
    cursor: { command: "agent", versionArgs: ["--version"], probeArgs: ["status"], exitCodeOnly: true },
    ...overrides,
  };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs()", () => {
  it("builds the expected config shape for each runtime", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--print"],
      "codex",
      ["exec", "-"],
      "agent",
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
      command: "agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes() / getLastResult()", () => {
  it("derives the required runtimes from AGENT_STAGES, leaving unused runtimes out", () => {
    const processRunner = { execute: vi.fn() };
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs(), makeMockLogger() as never);

    const required = check.getRequiredRuntimes();
    expect(required).toEqual(new Set(["claude-code", "codex"]));
  });

  it("returns undefined before any preflight has run", () => {
    const processRunner = { execute: vi.fn() };
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs(), makeMockLogger() as never);
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight() — success path", () => {
  it("resolves ok:true when every required runtime's binary and auth checks pass", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      if (opts.args.includes("--version")) {
        return result({ stdout: `${opts.command}-cli v9.9.9\nextra ignored line`, exitCode: 0 });
      }
      if (opts.command === "claude") {
        return result({ stdout: '{"loggedIn": true}', exitCode: 0 });
      }
      // codex probe
      return result({ stdout: "PONG\n", exitCode: 0 });
    });
    const processRunner = { execute };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs(), logger as never);

    const preflight = await check.runPreflight();

    expect(preflight.ok).toBe(true);
    expect(preflight.requiredRuntimes).toEqual(["claude-code", "codex"]);
    expect(preflight.skippedRuntimes).toEqual(["cursor"]);
    expect(preflight.results).toHaveLength(2);
    expect(preflight.totalDurationMs).toEqual(expect.any(Number));

    const claudeResult = preflight.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck).toMatchObject({ ok: true, version: "claude-cli v9.9.9" });
    expect(claudeResult.authCheck.ok).toBe(true);

    const codexResult = preflight.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.binaryCheck.ok).toBe(true);
    expect(codexResult.authCheck.ok).toBe(true);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
    expect(check.getLastResult()).toBe(preflight);
  });
});

describe("RuntimeHealthCheck.runPreflight() — binary check failures", () => {
  it("skips the auth check and throws PreflightError when a binary check times out", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      if (opts.command === "claude" && opts.args.includes("--version")) {
        return result({ timedOut: true, exitCode: 1 });
      }
      if (opts.args.includes("--version")) {
        return result({ stdout: "codex v1.0.0", exitCode: 0 });
      }
      return result({ stdout: "PONG", exitCode: 0 });
    });
    const processRunner = { execute };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);

    const lastResult = check.getLastResult();
    expect(lastResult?.ok).toBe(false);
    const claudeResult = lastResult?.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck).toMatchObject({ ok: false, error: "Timed out after 5000ms" });
    expect(claudeResult.authCheck).toEqual({
      ok: false,
      durationMs: 0,
      error: "Skipped: binary check failed",
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({
            runtime: "claude-code",
            binaryError: "Timed out after 5000ms",
            authError: "Skipped: binary check failed",
          }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("reports a non-zero exit code from the binary check with truncated stderr", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      if (opts.command === "claude" && opts.args.includes("--version")) {
        return result({ exitCode: 127, stderr: "command not found: claude", stdout: "" });
      }
      if (opts.args.includes("--version")) {
        return result({ stdout: "codex v1.0.0", exitCode: 0 });
      }
      return result({ stdout: "PONG", exitCode: 0 });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      baseConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.ok).toBe(false);
    expect(claudeResult.binaryCheck.error).toBe("Exit code 127: command not found: claude");
  });

  it("captures a rejected process execution as a binary check failure", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      if (opts.command === "claude" && opts.args.includes("--version")) {
        throw new Error("ENOENT: spawn claude");
      }
      if (opts.args.includes("--version")) {
        return result({ stdout: "codex v1.0.0", exitCode: 0 });
      }
      return result({ stdout: "PONG", exitCode: 0 });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      baseConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck).toMatchObject({ ok: false, error: "ENOENT: spawn claude" });
  });

  it("stringifies a non-Error thrown value from a rejected binary check", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      if (opts.command === "claude" && opts.args.includes("--version")) {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "raw binary failure";
      }
      if (opts.args.includes("--version")) {
        return result({ stdout: "codex v1.0.0", exitCode: 0 });
      }
      return result({ stdout: "PONG", exitCode: 0 });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      baseConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck).toMatchObject({ ok: false, error: "raw binary failure" });
  });
});

describe("RuntimeHealthCheck.runPreflight() — auth check branches", () => {
  function passingBinary(opts: { args: string[] }): ProcessResult | undefined {
    if (opts.args.includes("--version")) return result({ stdout: "v1.0.0", exitCode: 0 });
    return undefined;
  }

  it("fails when the successPattern is not found in the probe output", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      const binary = passingBinary(opts);
      if (binary) return binary;
      if (opts.command === "claude") return result({ stdout: "not logged in", exitCode: 0 });
      return result({ stdout: "PONG", exitCode: 0 });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      baseConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toContain("expected pattern not found in output");
    expect(claudeResult.authCheck.error).toContain("not logged in");
  });

  it("times out the auth probe", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      const binary = passingBinary(opts);
      if (binary) return binary;
      if (opts.command === "claude") return result({ timedOut: true, exitCode: 1 });
      return result({ stdout: "PONG", exitCode: 0 });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      baseConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck).toMatchObject({
      ok: false,
      error: "Auth probe timed out after 30000ms",
    });
  });

  it("captures a rejected auth probe execution", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      const binary = passingBinary(opts);
      if (binary) return binary;
      if (opts.command === "claude") throw new Error("socket hang up");
      return result({ stdout: "PONG", exitCode: 0 });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      baseConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck).toMatchObject({ ok: false, error: "socket hang up" });
  });

  it("stringifies a non-Error thrown value from a rejected auth probe", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      const binary = passingBinary(opts);
      if (binary) return binary;
      if (opts.command === "claude") {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "raw auth failure";
      }
      return result({ stdout: "PONG", exitCode: 0 });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      baseConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck).toMatchObject({ ok: false, error: "raw auth failure" });
  });

  it("passes exitCodeOnly checks on exit code 0 regardless of output", async () => {
    const configs = baseConfigs({
      codex: { command: "codex", versionArgs: ["--version"], probeArgs: ["status"], exitCodeOnly: true },
    });
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      const binary = passingBinary(opts);
      if (binary) return binary;
      if (opts.command === "claude") return result({ stdout: '{"loggedIn": true}', exitCode: 0 });
      return result({ stdout: "irrelevant output", exitCode: 0 });
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const preflight = await check.runPreflight();
    expect(preflight.ok).toBe(true);
  });

  it("fails exitCodeOnly checks on a non-zero exit code", async () => {
    const configs = baseConfigs({
      codex: { command: "codex", versionArgs: ["--version"], probeArgs: ["status"], exitCodeOnly: true },
    });
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      const binary = passingBinary(opts);
      if (binary) return binary;
      if (opts.command === "claude") return result({ stdout: '{"loggedIn": true}', exitCode: 0 });
      return result({ stdout: "", stderr: "no active session", exitCode: 2 });
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck).toMatchObject({
      ok: false,
      error: "Exit code 2: no active session",
    });
  });

  it("falls back to stdout in the exitCodeOnly error message when stderr is empty", async () => {
    const configs = baseConfigs({
      codex: { command: "codex", versionArgs: ["--version"], probeArgs: ["status"], exitCodeOnly: true },
    });
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      const binary = passingBinary(opts);
      if (binary) return binary;
      if (opts.command === "claude") return result({ stdout: '{"loggedIn": true}', exitCode: 0 });
      return result({ stdout: "denied on stdout", stderr: "", exitCode: 3 });
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck).toMatchObject({
      ok: false,
      error: "Exit code 3: denied on stdout",
    });
  });

  it("fails the generic (PONG) probe on a non-zero exit code without a pong response", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      const binary = passingBinary(opts);
      if (binary) return binary;
      if (opts.command === "claude") return result({ stdout: '{"loggedIn": true}', exitCode: 0 });
      return result({ stdout: "", stderr: "model unavailable", exitCode: 1 });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      baseConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck).toMatchObject({
      ok: false,
      error: "Exit code 1: model unavailable",
    });
  });

  it("fails the generic (PONG) probe when exit code is 0 but no pong is present", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      const binary = passingBinary(opts);
      if (binary) return binary;
      if (opts.command === "claude") return result({ stdout: '{"loggedIn": true}', exitCode: 0 });
      return result({ stdout: "quiet, no reply", exitCode: 0 });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      baseConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck).toMatchObject({
      ok: false,
      error: "Auth probe did not return expected response (got quiet, no reply)",
    });
  });

  it("passes the generic (PONG) probe when pong is present despite a non-zero exit code", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      const binary = passingBinary(opts);
      if (binary) return binary;
      if (opts.command === "claude") return result({ stdout: '{"loggedIn": true}', exitCode: 0 });
      // Non-zero exit but the model still replied PONG on stderr -- should still pass.
      return result({ stdout: "", stderr: "pong (with a warning)", exitCode: 1 });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      baseConfigs(),
      makeMockLogger() as never,
    );

    const preflight = await check.runPreflight();
    expect(preflight.ok).toBe(true);
  });
});
