import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeMockProcessRunner() {
  return { execute: vi.fn() };
}

function okResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 5, timedOut: false, ...overrides };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs()", () => {
  it("builds the expected per-runtime probe configuration", () => {
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
  it("derives required runtimes from AGENT_STAGES (claude-code and codex, but not cursor)", () => {
    const processRunner = makeMockProcessRunner();
    const health = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent"),
      makeMockLogger() as never,
    );

    const required = health.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });

  it("returns undefined from getLastResult() before any preflight has run", () => {
    const processRunner = makeMockProcessRunner();
    const health = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent"),
      makeMockLogger() as never,
    );

    expect(health.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight() — success path", () => {
  let processRunner: ReturnType<typeof makeMockProcessRunner>;
  let logger: ReturnType<typeof makeMockLogger>;
  let health: RuntimeHealthCheck;

  beforeEach(() => {
    processRunner = makeMockProcessRunner();
    logger = makeMockLogger();
    health = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent"),
      logger as never,
    );

    processRunner.execute.mockImplementation((opts: { args: string[]; stdinData?: string }) => {
      if (opts.args.includes("--version")) {
        return Promise.resolve(okResult({ stdout: "1.2.3\n" }));
      }
      if (opts.args.includes("auth")) {
        return Promise.resolve(okResult({ stdout: '{"loggedIn": true}' }));
      }
      if (opts.stdinData) {
        return Promise.resolve(okResult({ stdout: "PONG\n" }));
      }
      return Promise.resolve(okResult());
    });
  });

  it("resolves ok:true, records skippedRuntimes, and stores getLastResult()", async () => {
    const result = await health.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(result.totalDurationMs).toEqual(expect.any(Number));
    expect(health.getLastResult()).toBe(result);

    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck).toMatchObject({ ok: true, version: "1.2.3" });
    expect(claudeResult.authCheck).toMatchObject({ ok: true });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("RuntimeHealthCheck.runPreflight() — failure paths", () => {
  it("throws PreflightError and logs failures when a binary check fails", async () => {
    const processRunner = makeMockProcessRunner();
    const logger = makeMockLogger();
    const health = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent"),
      logger as never,
    );

    processRunner.execute.mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.command === "codex" && opts.args.includes("--version")) {
        return Promise.resolve(okResult({ exitCode: 127, stderr: "command not found" }));
      }
      if (opts.args.includes("--version")) return Promise.resolve(okResult({ stdout: "1.0.0" }));
      if (opts.args.includes("auth")) {
        return Promise.resolve(okResult({ stdout: '{"loggedIn": true}' }));
      }
      return Promise.resolve(okResult());
    });

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);

    const lastResult = health.getLastResult();
    expect(lastResult?.ok).toBe(false);
    const codexResult = lastResult?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.binaryCheck.ok).toBe(false);
    expect(codexResult?.binaryCheck.error).toContain("Exit code 127");
    // Auth check is skipped entirely once the binary check fails.
    expect(codexResult?.authCheck).toEqual({
      ok: false,
      durationMs: 0,
      error: "Skipped: binary check failed",
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([expect.objectContaining({ runtime: "codex" })]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("PreflightError carries a summary whose failing runtimes are named in the message", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockResolvedValue(okResult({ exitCode: 1, stderr: "nope" }));
    const health = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent"),
      makeMockLogger() as never,
    );

    try {
      await health.runPreflight();
      expect.unreachable("expected runPreflight to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightError);
      const preflightErr = err as PreflightError;
      expect(preflightErr.message).toContain("claude-code");
      expect(preflightErr.message).toContain("codex");
      expect(preflightErr.result.ok).toBe(false);
    }
  });

  it("marks the binary check failed when the version probe times out", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockResolvedValue(
      okResult({ timedOut: true, stdout: "", stderr: "" }),
    );
    const health = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent"),
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const result = health.getLastResult();
    const claudeResult = result?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toBe("Timed out after 5000ms");
  });

  it("marks the auth check failed when the auth probe times out", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return Promise.resolve(okResult({ stdout: "1.0.0" }));
      return Promise.resolve(okResult({ timedOut: true }));
    });
    const health = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent"),
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const result = health.getLastResult();
    const claudeResult = result?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toBe("Auth probe timed out after 30000ms");
  });

  it("fails the auth check when a successPattern is configured but does not match the output", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return Promise.resolve(okResult({ stdout: "1.0.0" }));
      if (opts.args.includes("auth")) {
        return Promise.resolve(okResult({ stdout: '{"loggedIn": false}' }));
      }
      return Promise.resolve(okResult({ stdout: "PONG" }));
    });
    const health = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent"),
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = health.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("expected pattern not found");
  });

  it("exitCodeOnly configs pass the auth check on exit code 0 regardless of output content", async () => {
    const processRunner = makeMockProcessRunner();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      [],
      "codex",
      ["exec", "-"],
      "agent",
    );
    configs["claude-code"] = {
      ...configs["claude-code"],
      successPattern: undefined,
      exitCodeOnly: true,
    };

    processRunner.execute.mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return Promise.resolve(okResult({ stdout: "1.0.0" }));
      if (opts.command === "claude") {
        return Promise.resolve(okResult({ exitCode: 0, stdout: "whatever" }));
      }
      return Promise.resolve(okResult({ stdout: "PONG" }));
    });

    const health = new RuntimeHealthCheck(
      processRunner as never,
      configs,
      makeMockLogger() as never,
    );

    const result = await health.runPreflight();
    expect(result.ok).toBe(true);
    const claudeResult = result.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck).toEqual({ ok: true, durationMs: expect.any(Number) });
  });

  it("exitCodeOnly configs pass on exit 0 and fail on non-zero exit, without needing an output pattern", async () => {
    const processRunner = makeMockProcessRunner();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      [],
      "codex",
      ["exec", "-"],
      "agent",
    );
    // Swap claude-code's auth probe for an exitCodeOnly check, exercising that branch
    // through a runtime that IS required (claude-code is always required via AGENT_STAGES).
    configs["claude-code"] = {
      ...configs["claude-code"],
      successPattern: undefined,
      exitCodeOnly: true,
    };

    processRunner.execute.mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return Promise.resolve(okResult({ stdout: "1.0.0" }));
      if (opts.command === "claude") {
        return Promise.resolve(okResult({ exitCode: 3, stderr: "not logged in" }));
      }
      return Promise.resolve(okResult({ stdout: "PONG" }));
    });

    const health = new RuntimeHealthCheck(
      processRunner as never,
      configs,
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = health.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("Exit code 3");
  });

  it("falls back to stdout in the exitCodeOnly error message when stderr is empty", async () => {
    const processRunner = makeMockProcessRunner();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      [],
      "codex",
      ["exec", "-"],
      "agent",
    );
    configs["claude-code"] = {
      ...configs["claude-code"],
      successPattern: undefined,
      exitCodeOnly: true,
    };

    processRunner.execute.mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return Promise.resolve(okResult({ stdout: "1.0.0" }));
      if (opts.command === "claude") {
        return Promise.resolve(okResult({ exitCode: 5, stderr: "", stdout: "stdout-only" }));
      }
      return Promise.resolve(okResult({ stdout: "PONG" }));
    });

    const health = new RuntimeHealthCheck(
      processRunner as never,
      configs,
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = health.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.error).toContain("stdout-only");
  });

  it("fails the pong-style auth check when exit code is non-zero and no pong is found", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return Promise.resolve(okResult({ stdout: "1.0.0" }));
      if (opts.args.includes("auth")) {
        return Promise.resolve(okResult({ stdout: '{"loggedIn": true}' }));
      }
      // codex probe: neither successPattern nor exitCodeOnly configured by default
      return Promise.resolve(okResult({ exitCode: 1, stderr: "connection refused" }));
    });
    const health = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent"),
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const codexResult = health.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("Exit code 1");
  });

  it("fails the pong-style auth check when exit code is 0 but no pong is found in the output", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return Promise.resolve(okResult({ stdout: "1.0.0" }));
      if (opts.args.includes("auth")) {
        return Promise.resolve(okResult({ stdout: '{"loggedIn": true}' }));
      }
      return Promise.resolve(okResult({ stdout: "unexpected output" }));
    });
    const health = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent"),
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const codexResult = health.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("did not return expected response");
  });

  it("catches a rejected binary probe and reports it as a failed binaryCheck", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return Promise.reject(new Error("spawn ENOENT"));
      return Promise.resolve(okResult());
    });
    const health = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent"),
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const results = health.getLastResult()?.results ?? [];
    for (const r of results) {
      expect(r.binaryCheck.ok).toBe(false);
      expect(r.binaryCheck.error).toBe("spawn ENOENT");
    }
  });

  it("stringifies a non-Error thrown value from a rejected binary probe", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation((opts: { args: string[] }) => {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      if (opts.args.includes("--version")) return Promise.reject("plain string failure");
      return Promise.resolve(okResult());
    });
    const health = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent"),
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const results = health.getLastResult()?.results ?? [];
    for (const r of results) {
      expect(r.binaryCheck.error).toBe("plain string failure");
    }
  });

  it("stringifies a non-Error thrown value from a rejected auth probe", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return Promise.resolve(okResult({ stdout: "1.0.0" }));
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      return Promise.reject("auth blew up");
    });
    const health = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent"),
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const results = health.getLastResult()?.results ?? [];
    for (const r of results) {
      expect(r.authCheck.error).toBe("auth blew up");
    }
  });

  it("catches a rejected auth probe and reports it as a failed authCheck", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return Promise.resolve(okResult({ stdout: "1.0.0" }));
      return Promise.reject(new Error("probe crashed"));
    });
    const health = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent"),
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const results = health.getLastResult()?.results ?? [];
    for (const r of results) {
      expect(r.authCheck.ok).toBe(false);
      expect(r.authCheck.error).toBe("probe crashed");
    }
  });
});
