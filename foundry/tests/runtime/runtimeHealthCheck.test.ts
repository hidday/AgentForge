import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeProcessRunner() {
  return { execute: vi.fn() };
}

function ok(stdout: string, overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout, stderr: "", exitCode: 0, durationMs: 5, timedOut: false, ...overrides };
}

/**
 * A blanket "everything healthy" execute() implementation that answers
 * correctly for both required runtimes' probe strategies: claude-code's
 * `successPattern` (loggedIn:true) and codex's default PONG echo check.
 */
function healthyExecuteImpl({ command, args }: { command: string; args: string[] }) {
  if (args[0] === "--version") return Promise.resolve(ok(`${command} version 1.0.0`));
  if (command === "claude") return Promise.resolve(ok('{"loggedIn": true}'));
  return Promise.resolve(ok("PONG"));
}

// Only "claude-code" and "codex" are ever required (no AGENT_STAGES entry uses
// "cursor"), so tests target those two runtime slots even when repurposing
// their config to exercise a different auth-check strategy than
// buildRuntimeConfigs would normally assign them.
function baseConfigs() {
  return {
    "claude-code": {
      command: "claude",
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    },
    codex: {
      command: "codex",
      versionArgs: ["--version"],
      probeArgs: ["exec"],
      probeStdin: "Respond with exactly: PONG",
    },
    cursor: {
      command: "cursor-agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    },
  };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds the expected per-runtime probe configuration", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--dangerously-skip-permissions"],
      "codex",
      ["exec"],
      "cursor-agent",
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
      probeArgs: ["exec"],
      probeStdin: "Respond with exactly: PONG",
    });
    expect(configs.cursor).toMatchObject({
      command: "cursor-agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes / getLastResult", () => {
  it("derives the required runtime set from AGENT_STAGES (claude-code and codex only)", () => {
    const check = new RuntimeHealthCheck(makeProcessRunner() as never, baseConfigs(), makeLogger() as never);
    const required = check.getRequiredRuntimes();
    expect(required).toEqual(new Set<AgentRuntime>(["claude-code", "codex"]));
  });

  it("returns undefined for getLastResult before any preflight has run", () => {
    const check = new RuntimeHealthCheck(makeProcessRunner() as never, baseConfigs(), makeLogger() as never);
    expect(check.getLastResult()).toBeUndefined();
  });

  it("caches the most recent result after a successful run", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(healthyExecuteImpl);
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs(), makeLogger() as never);

    const result = await check.runPreflight();

    expect(check.getLastResult()).toBe(result);
  });
});

describe("RuntimeHealthCheck.runPreflight", () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  it("passes when both required runtimes are installed and authenticated", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(healthyExecuteImpl);
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs(), logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtimes: ["claude-code", "codex"] }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("throws PreflightError with a PreflightSummary-shaped result when a binary is missing", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.command === "claude") {
        return Promise.reject(Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }));
      }
      return healthyExecuteImpl(opts);
    });
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs(), logger as never);

    const error = await check.runPreflight().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PreflightError);
    const preflightError = error as PreflightError;
    expect(preflightError.result.ok).toBe(false);
    expect(preflightError.result.requiredRuntimes).toEqual(["claude-code", "codex"]);
    const claudeResult = preflightError.result.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toContain("spawn claude ENOENT");
    // The auth probe is skipped entirely once the binary check fails.
    expect(claudeResult?.authCheck).toEqual({
      ok: false,
      durationMs: 0,
      error: "Skipped: binary check failed",
    });
    const codexResult = preflightError.result.results.find((r) => r.runtime === "codex");
    expect(codexResult?.binaryCheck.ok).toBe(true);
    expect(codexResult?.authCheck.ok).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      {
        failures: [
          {
            runtime: "claude-code",
            command: "claude",
            binaryError: expect.stringContaining("ENOENT") as unknown as string,
            authError: "Skipped: binary check failed",
          },
        ],
        totalDurationMs: expect.any(Number) as unknown as number,
      },
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("fails when the binary is present but auth fails, without skipping the binary check", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return Promise.resolve(ok(`${opts.command} v1.2.3`));
      if (opts.command === "claude") return Promise.resolve(ok('{"loggedIn": false}'));
      return Promise.resolve(ok("PONG"));
    });
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs(), logger as never);

    const error = (await check.runPreflight().catch((e: unknown) => e)) as PreflightError;

    expect(error).toBeInstanceOf(PreflightError);
    const claudeResult = error.result.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(true);
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("expected pattern not found");
  });

  it("only calls execute once per runtime (binary check only) when the binary check fails", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(({ command }: { command: string }) => {
      if (command === "claude") return Promise.resolve(ok("", { exitCode: 127 }));
      return Promise.resolve(ok('{"loggedIn": true}'));
    });
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs(), logger as never);

    await check.runPreflight().catch(() => undefined);

    const claudeCalls = processRunner.execute.mock.calls.filter(
      ([opts]: [{ command: string }]) => opts.command === "claude",
    );
    expect(claudeCalls).toHaveLength(1);
  });
});

describe("RuntimeHealthCheck binary check boundary conditions", () => {
  it("reports a timeout", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue(ok("", { timedOut: true }));
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs(), makeLogger() as never);

    const error = (await check.runPreflight().catch((e: unknown) => e)) as PreflightError;
    const r = error.result.results.find((x) => x.runtime === "claude-code");
    expect(r?.binaryCheck.ok).toBe(false);
    expect(r?.binaryCheck.error).toBe("Timed out after 5000ms");
  });

  it("reports a non-zero exit code with a truncated stderr snippet", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue(
      ok("", { exitCode: 127, stderr: "command not found: claude" }),
    );
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs(), makeLogger() as never);

    const error = (await check.runPreflight().catch((e: unknown) => e)) as PreflightError;
    const r = error.result.results.find((x) => x.runtime === "claude-code");
    expect(r?.binaryCheck.ok).toBe(false);
    expect(r?.binaryCheck.error).toBe("Exit code 127: command not found: claude");
  });

  it("captures the first line of stdout as the version, truncated to 100 chars", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        return Promise.resolve(ok(`  ${"v".repeat(150)}\nextra line\n`));
      }
      return healthyExecuteImpl(opts);
    });
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs(), makeLogger() as never);

    const result = await check.runPreflight();
    const r = result.results.find((x) => x.runtime === "claude-code");
    expect(r?.binaryCheck.ok).toBe(true);
    expect(r?.binaryCheck.version).toHaveLength(100);
    expect(r?.binaryCheck.version).not.toContain("extra line");
  });

  it("catches a thrown error from execute and reports its message", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(({ command }: { command: string }) => {
      if (command === "claude") return Promise.reject(new Error("permission denied"));
      return Promise.resolve(ok('{"loggedIn": true}'));
    });
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs(), makeLogger() as never);

    const error = (await check.runPreflight().catch((e: unknown) => e)) as PreflightError;
    const r = error.result.results.find((x) => x.runtime === "claude-code");
    expect(r?.binaryCheck.error).toBe("permission denied");
  });

  it("stringifies a non-Error thrown value from execute", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(({ command }: { command: string }) => {
      if (command === "claude") return Promise.reject("plain string crash");
      return Promise.resolve(ok('{"loggedIn": true}'));
    });
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs(), makeLogger() as never);

    const error = (await check.runPreflight().catch((e: unknown) => e)) as PreflightError;
    const r = error.result.results.find((x) => x.runtime === "claude-code");
    expect(r?.binaryCheck.error).toBe("plain string crash");
  });
});

describe("RuntimeHealthCheck auth check strategies", () => {
  function configsWithClaudeCodeAuth(overrides: Record<string, unknown>) {
    const configs = baseConfigs();
    return {
      ...configs,
      "claude-code": { ...configs["claude-code"], ...overrides },
    };
  }

  /**
   * Builds an execute() implementation where claude-code's binary check
   * always passes and codex's probes always pass (via healthyExecuteImpl),
   * while claude-code's *auth* probe is answered by `authResult` — isolating
   * the auth-check branch under test to a single required runtime.
   */
  function execWithClaudeAuth(authResult: ProcessResult | Promise<ProcessResult>) {
    return (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] !== "--version") {
        return Promise.resolve(authResult);
      }
      return healthyExecuteImpl(opts);
    };
  }

  it("successPattern: passes when the pattern matches stdout+stderr", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(execWithClaudeAuth(ok('{"loggedIn":true}')));
    const check = new RuntimeHealthCheck(
      processRunner as never,
      configsWithClaudeCodeAuth({ successPattern: '"loggedIn":\\s*true' }),
      makeLogger() as never,
    );

    const result = await check.runPreflight();
    expect(result.results.find((r) => r.runtime === "claude-code")?.authCheck.ok).toBe(true);
  });

  it("successPattern: fails with a snippet when the pattern does not match", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(execWithClaudeAuth(ok('{"loggedIn":false}')));
    const check = new RuntimeHealthCheck(
      processRunner as never,
      configsWithClaudeCodeAuth({ successPattern: '"loggedIn":\\s*true' }),
      makeLogger() as never,
    );

    const error = (await check.runPreflight().catch((e: unknown) => e)) as PreflightError;
    const r = error.result.results.find((x) => x.runtime === "claude-code");
    expect(r?.authCheck.ok).toBe(false);
    expect(r?.authCheck.error).toContain('{"loggedIn":false}');
  });

  it("successPattern: reports a timeout on the auth probe", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(execWithClaudeAuth(ok("", { timedOut: true })));
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs(), makeLogger() as never);

    const error = (await check.runPreflight().catch((e: unknown) => e)) as PreflightError;
    const r = error.result.results.find((x) => x.runtime === "claude-code");
    expect(r?.authCheck.error).toBe("Auth probe timed out after 30000ms");
  });

  it("successPattern: catches a thrown error from execute", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] !== "--version") {
        return Promise.reject(new Error("auth probe crashed"));
      }
      return healthyExecuteImpl(opts);
    });
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs(), makeLogger() as never);

    const error = (await check.runPreflight().catch((e: unknown) => e)) as PreflightError;
    const r = error.result.results.find((x) => x.runtime === "claude-code");
    expect(r?.authCheck.error).toBe("auth probe crashed");
  });

  it("exitCodeOnly: passes purely on exit code 0", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(execWithClaudeAuth(ok("anything", { exitCode: 0 })));
    const check = new RuntimeHealthCheck(
      processRunner as never,
      configsWithClaudeCodeAuth({ successPattern: undefined, exitCodeOnly: true }),
      makeLogger() as never,
    );

    const result = await check.runPreflight();
    expect(result.results.find((r) => r.runtime === "claude-code")?.authCheck.ok).toBe(true);
  });

  it("exitCodeOnly: fails with a stderr/stdout snippet on non-zero exit", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(
      execWithClaudeAuth(ok("out", { exitCode: 3, stderr: "not logged in" })),
    );
    const check = new RuntimeHealthCheck(
      processRunner as never,
      configsWithClaudeCodeAuth({ successPattern: undefined, exitCodeOnly: true }),
      makeLogger() as never,
    );

    const error = (await check.runPreflight().catch((e: unknown) => e)) as PreflightError;
    const r = error.result.results.find((x) => x.runtime === "claude-code");
    expect(r?.authCheck.error).toBe("Exit code 3: not logged in");
  });

  it("exitCodeOnly: falls back to the stdout snippet when stderr is empty", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(
      execWithClaudeAuth(ok("logged out", { exitCode: 3, stderr: "" })),
    );
    const check = new RuntimeHealthCheck(
      processRunner as never,
      configsWithClaudeCodeAuth({ successPattern: undefined, exitCodeOnly: true }),
      makeLogger() as never,
    );

    const error = (await check.runPreflight().catch((e: unknown) => e)) as PreflightError;
    const r = error.result.results.find((x) => x.runtime === "claude-code");
    expect(r?.authCheck.error).toBe("Exit code 3: logged out");
  });

  it("stringifies a non-Error thrown value from the auth probe", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] !== "--version") {
        return Promise.reject("auth probe string crash");
      }
      return healthyExecuteImpl(opts);
    });
    const check = new RuntimeHealthCheck(processRunner as never, baseConfigs(), makeLogger() as never);

    const error = (await check.runPreflight().catch((e: unknown) => e)) as PreflightError;
    const r = error.result.results.find((x) => x.runtime === "claude-code");
    expect(r?.authCheck.error).toBe("auth probe string crash");
  });

  it("default PONG check: passes when exit code is 0 and output contains 'pong'", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(execWithClaudeAuth(ok("PONG", { exitCode: 0 })));
    const check = new RuntimeHealthCheck(
      processRunner as never,
      configsWithClaudeCodeAuth({ successPattern: undefined }),
      makeLogger() as never,
    );

    const result = await check.runPreflight();
    expect(result.results.find((r) => r.runtime === "claude-code")?.authCheck.ok).toBe(true);
  });

  it("default PONG check: still passes on a non-zero exit code as long as PONG is present", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(
      execWithClaudeAuth(ok("PONG", { exitCode: 1, stderr: "warning: deprecated" })),
    );
    const check = new RuntimeHealthCheck(
      processRunner as never,
      configsWithClaudeCodeAuth({ successPattern: undefined }),
      makeLogger() as never,
    );

    const result = await check.runPreflight();
    expect(result.results.find((r) => r.runtime === "claude-code")?.authCheck.ok).toBe(true);
  });

  it("default PONG check: fails on non-zero exit with no PONG in output", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(
      execWithClaudeAuth(ok("", { exitCode: 1, stderr: "crashed" })),
    );
    const check = new RuntimeHealthCheck(
      processRunner as never,
      configsWithClaudeCodeAuth({ successPattern: undefined }),
      makeLogger() as never,
    );

    const error = (await check.runPreflight().catch((e: unknown) => e)) as PreflightError;
    const r = error.result.results.find((x) => x.runtime === "claude-code");
    expect(r?.authCheck.error).toBe("Exit code 1: crashed");
  });

  it("default PONG check: fails on exit code 0 with no PONG in output", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(execWithClaudeAuth(ok("I don't understand", { exitCode: 0 })));
    const check = new RuntimeHealthCheck(
      processRunner as never,
      configsWithClaudeCodeAuth({ successPattern: undefined }),
      makeLogger() as never,
    );

    const error = (await check.runPreflight().catch((e: unknown) => e)) as PreflightError;
    const r = error.result.results.find((x) => x.runtime === "claude-code");
    expect(r?.authCheck.error).toContain("Auth probe did not return expected response");
  });
});
