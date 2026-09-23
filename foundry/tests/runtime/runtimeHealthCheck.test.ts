import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeProcessRunner() {
  return { execute: vi.fn() };
}

function okResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 5, timedOut: false, ...overrides };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs()", () => {
  it("builds a config keyed by runtime with the expected shape for each CLI", () => {
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

describe("RuntimeHealthCheck.getRequiredRuntimes()", () => {
  it("returns the distinct set of runtimes actually used by AGENT_STAGES", () => {
    const processRunner = makeProcessRunner();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent");
    const health = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    const required = health.getRequiredRuntimes();
    expect([...required].sort()).toEqual(["claude-code", "codex"]);
    expect(required.has("cursor")).toBe(false);
  });
});

describe("RuntimeHealthCheck.getLastResult()", () => {
  it("is undefined before runPreflight() has ever been called", () => {
    const processRunner = makeProcessRunner();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent");
    const health = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
    expect(health.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight()", () => {
  it("resolves ok:true when every required runtime's binary and auth checks pass", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        return okResult({ stdout: "claude-cli 1.2.3\n" });
      }
      if (opts.command === "claude" && opts.args[0] === "auth") {
        return okResult({ stdout: '{"loggedIn": true}' });
      }
      if (opts.command === "codex" && opts.args[0] === "--version") {
        return okResult({ stdout: "codex-cli 0.9.0\n" });
      }
      if (opts.command === "codex") {
        return okResult({ stdout: "PONG\n" });
      }
      throw new Error(`unexpected call: ${opts.command} ${opts.args.join(" ")}`);
    });

    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      [],
      "codex",
      ["exec", "-"],
      "agent",
    );
    const health = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await health.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    for (const r of result.results) {
      expect(r.binaryCheck.ok).toBe(true);
      expect(r.authCheck.ok).toBe(true);
    }
    expect(health.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("throws PreflightError, stores the failed result, and logs failures when a runtime is unhealthy", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        // Claude binary check fails outright.
        return okResult({ exitCode: 127, stderr: "command not found" });
      }
      if (opts.command === "codex" && opts.args[0] === "--version") {
        return okResult({ stdout: "codex-cli 0.9.0\n" });
      }
      if (opts.command === "codex") {
        return okResult({ stdout: "PONG\n" });
      }
      throw new Error(`unexpected call: ${opts.command} ${opts.args.join(" ")}`);
    });

    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      [],
      "codex",
      ["exec", "-"],
      "agent",
    );
    const health = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    let caught: unknown;
    try {
      await health.runPreflight();
      expect.fail("should have thrown");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PreflightError);
    const preflightError = caught as PreflightError;
    expect(preflightError.result.ok).toBe(false);

    // The stored lastResult reflects the failed run even though it threw.
    const lastResult = health.getLastResult();
    expect(lastResult).toBeDefined();
    expect(lastResult?.ok).toBe(false);

    const claudeResult = lastResult?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toContain("Exit code 127");
    // Auth check is skipped entirely when the binary check fails.
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toBe("Skipped: binary check failed");
    expect(claudeResult?.authCheck.durationMs).toBe(0);

    const codexResult = lastResult?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.binaryCheck.ok).toBe(true);
    expect(codexResult?.authCheck.ok).toBe(true);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: [
          expect.objectContaining({
            runtime: "claude-code",
            binaryError: expect.stringContaining("Exit code 127"),
            authError: "Skipped: binary check failed",
          }),
        ],
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("reports binaryError as undefined for a runtime whose binary check passed but auth check failed", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        return okResult({ stdout: "claude-cli 1.2.3\n" });
      }
      if (opts.command === "claude" && opts.args[0] === "auth") {
        return okResult({ stdout: '{"loggedIn": true}' });
      }
      if (opts.command === "codex" && opts.args[0] === "--version") {
        // Codex binary check passes...
        return okResult({ stdout: "codex-cli 0.9.0\n" });
      }
      if (opts.command === "codex") {
        // ...but the auth probe never says PONG.
        return okResult({ exitCode: 0, stdout: "I decline to respond." });
      }
      throw new Error(`unexpected call: ${opts.command} ${opts.args.join(" ")}`);
    });

    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      [],
      "codex",
      ["exec", "-"],
      "agent",
    );
    const health = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: [
          expect.objectContaining({
            runtime: "codex",
            binaryError: undefined,
            authError: expect.stringContaining("Auth probe did not return expected response"),
          }),
        ],
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });
});

describe("RuntimeHealthCheck private checkBinary() branches", () => {
  function makeHealth(processRunner: { execute: ReturnType<typeof vi.fn> }) {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent");
    return new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
  }

  const versionConfig = { command: "claude", versionArgs: ["--version"], probeArgs: [] };

  it("reports not-ok with a timeout message when the version probe times out", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue(okResult({ timedOut: true }));
    const health = makeHealth(processRunner);

    const result = await (health as unknown as {
      checkBinary: (c: unknown) => Promise<{ ok: boolean; error?: string; durationMs: number }>;
    }).checkBinary(versionConfig);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Timed out after \d+ms/);
  });

  it("reports not-ok with the exit code and a stderr snippet on non-zero exit", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue(
      okResult({ exitCode: 1, stderr: "binary missing shared library" }),
    );
    const health = makeHealth(processRunner);

    const result = await (health as unknown as {
      checkBinary: (c: unknown) => Promise<{ ok: boolean; error?: string }>;
    }).checkBinary(versionConfig);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Exit code 1: binary missing shared library");
  });

  it("reports ok with the first line of stdout (truncated to 100 chars) as the version", async () => {
    const processRunner = makeProcessRunner();
    const longFirstLine = "v" + "9".repeat(150);
    processRunner.execute.mockResolvedValue(
      okResult({ stdout: `${longFirstLine}\nsome extra trailing metadata line` }),
    );
    const health = makeHealth(processRunner);

    const result = await (health as unknown as {
      checkBinary: (c: unknown) => Promise<{ ok: boolean; version?: string }>;
    }).checkBinary(versionConfig);

    expect(result.ok).toBe(true);
    expect(result.version).toBe(longFirstLine.slice(0, 100));
    expect(result.version?.length).toBe(100);
  });

  it("reports not-ok with the error message when processRunner.execute rejects", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockRejectedValue(new Error("ENOENT: spawn claude"));
    const health = makeHealth(processRunner);

    const result = await (health as unknown as {
      checkBinary: (c: unknown) => Promise<{ ok: boolean; error?: string }>;
    }).checkBinary(versionConfig);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("ENOENT: spawn claude");
  });

  it("stringifies a non-Error rejection", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockRejectedValue("raw string failure");
    const health = makeHealth(processRunner);

    const result = await (health as unknown as {
      checkBinary: (c: unknown) => Promise<{ ok: boolean; error?: string }>;
    }).checkBinary(versionConfig);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("raw string failure");
  });
});

describe("RuntimeHealthCheck private checkAuth() branches", () => {
  function makeHealth(processRunner: { execute: ReturnType<typeof vi.fn> }) {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent");
    return new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
  }

  type CheckAuthResult = { ok: boolean; durationMs: number; error?: string };
  function getCheckAuth(health: RuntimeHealthCheck) {
    const casted = health as unknown as { checkAuth: (c: unknown) => Promise<CheckAuthResult> };
    return (config: unknown) => casted.checkAuth(config);
  }

  it("reports not-ok with a timeout message when the auth probe times out", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue(okResult({ timedOut: true }));
    const health = makeHealth(processRunner);

    const result = await getCheckAuth(health)({
      command: "claude",
      versionArgs: [],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Auth probe timed out after \d+ms/);
  });

  it("passes when successPattern matches combined stdout+stderr", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue(okResult({ stdout: '{"loggedIn": true}' }));
    const health = makeHealth(processRunner);

    const result = await getCheckAuth(health)({
      command: "claude",
      versionArgs: [],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });

    expect(result.ok).toBe(true);
  });

  it("fails with an explanatory error when successPattern does not match", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue(okResult({ stdout: '{"loggedIn": false}' }));
    const health = makeHealth(processRunner);

    const result = await getCheckAuth(health)({
      command: "claude",
      versionArgs: [],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("expected pattern not found in output");
    expect(result.error).toContain('"loggedIn": false');
  });

  it("passes on exit code 0 alone when exitCodeOnly is set", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue(okResult({ exitCode: 0, stdout: "status: ok" }));
    const health = makeHealth(processRunner);

    const result = await getCheckAuth(health)({
      command: "agent",
      versionArgs: [],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });

    expect(result.ok).toBe(true);
  });

  it("fails with the exit code and stderr/stdout snippet when exitCodeOnly and exit is non-zero", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue(
      okResult({ exitCode: 2, stderr: "", stdout: "not logged in" }),
    );
    const health = makeHealth(processRunner);

    const result = await getCheckAuth(health)({
      command: "agent",
      versionArgs: [],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });

    expect(result.ok).toBe(false);
    // stderr is empty, so falls back to stdout in the message.
    expect(result.error).toBe("Exit code 2: not logged in");
  });

  it("passes on the default PONG check when output contains 'pong' even if exit code is non-zero", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue(okResult({ exitCode: 1, stdout: "PONG" }));
    const health = makeHealth(processRunner);

    const result = await getCheckAuth(health)({
      command: "codex",
      versionArgs: [],
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });

    expect(result.ok).toBe(true);
  });

  it("fails on the default check with an exit-code error when exit is non-zero and no PONG is found", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue(
      okResult({ exitCode: 1, stderr: "auth required", stdout: "" }),
    );
    const health = makeHealth(processRunner);

    const result = await getCheckAuth(health)({
      command: "codex",
      versionArgs: [],
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Exit code 1: auth required");
  });

  it("fails on the default check with an 'unexpected response' error when exit is zero but no PONG is found", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue(okResult({ exitCode: 0, stdout: "I refuse to comply." }));
    const health = makeHealth(processRunner);

    const result = await getCheckAuth(health)({
      command: "codex",
      versionArgs: [],
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Auth probe did not return expected response");
    expect(result.error).toContain("I refuse to comply.");
  });

  it("reports not-ok with the error message when processRunner.execute rejects", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockRejectedValue(new Error("connection reset"));
    const health = makeHealth(processRunner);

    const result = await getCheckAuth(health)({
      command: "codex",
      versionArgs: [],
      probeArgs: ["exec", "-"],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("connection reset");
  });

  it("stringifies a non-Error rejection", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockRejectedValue({ reason: "weird" });
    const health = makeHealth(processRunner);

    const result = await getCheckAuth(health)({
      command: "codex",
      versionArgs: [],
      probeArgs: ["exec", "-"],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe(String({ reason: "weird" }));
  });
});
