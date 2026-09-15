import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function okResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 5, timedOut: false, ...overrides };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs()", () => {
  it("builds configs with the expected auth-probe style per runtime", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--print"],
      "codex",
      ["exec", "-"],
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
      probeArgs: ["exec", "-"],
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

describe("RuntimeHealthCheck.getRequiredRuntimes()", () => {
  it("returns the distinct set of runtimes used by AGENT_STAGES (cursor is unused/skipped)", () => {
    const processRunner = { execute: vi.fn() };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const healthCheck = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    const required = healthCheck.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });
});

describe("RuntimeHealthCheck.runPreflight()", () => {
  it("resolves ok:true when every required runtime's binary+auth checks pass, and records skippedRuntimes", async () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const logger = makeMockLogger();
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      if (opts.args[0] === "--version") {
        return okResult({ stdout: `${opts.command} v1.0.0\n` });
      }
      if (opts.command === "claude") {
        return okResult({ stdout: '{"loggedIn": true}' });
      }
      // codex probe
      return okResult({ stdout: "PONG" });
    });
    const processRunner = { execute };

    const healthCheck = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    const result = await healthCheck.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"].sort());
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(healthCheck.getLastResult()).toBe(result);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("throws PreflightError with a result.result shape describing the failures when any check fails", async () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const logger = makeMockLogger();
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      if (opts.args[0] === "--version") {
        return okResult({ stdout: `${opts.command} v1.0.0\n` });
      }
      if (opts.command === "claude") {
        // auth fails: pattern won't match
        return okResult({ stdout: '{"loggedIn": false}' });
      }
      return okResult({ stdout: "PONG" });
    });
    const processRunner = { execute };

    const healthCheck = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(healthCheck.runPreflight()).rejects.toThrow(PreflightError);

    try {
      await healthCheck.runPreflight();
      expect.unreachable("expected runPreflight to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightError);
      const preflightErr = err as PreflightError;
      expect(preflightErr.result.ok).toBe(false);
      const claudeResult = preflightErr.result.results.find((r) => r.runtime === "claude-code")!;
      expect(claudeResult.binaryCheck.ok).toBe(true);
      expect(claudeResult.authCheck.ok).toBe(false);
      expect(claudeResult.authCheck.error).toContain("expected pattern not found");
      const codexResult = preflightErr.result.results.find((r) => r.runtime === "codex")!;
      expect(codexResult.authCheck.ok).toBe(true);
    }
    expect(logger.error).toHaveBeenCalled();
  });
});

// checkBinary / checkAuth are private; TS privacy is compile-time only, so we
// reach them directly to exercise every branch without needing a full
// required-runtime round trip (e.g. cursor's exitCodeOnly probe style, which
// AGENT_STAGES never actually requires).
describe("RuntimeHealthCheck private probes (checkBinary / checkAuth)", () => {
  function makeHealthCheck(execute: (...args: unknown[]) => unknown) {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const processRunner = { execute };
    const logger = makeMockLogger();
    return {
      healthCheck: new RuntimeHealthCheck(processRunner as never, configs, logger as never) as never as {
        checkBinary: (config: unknown) => Promise<{ ok: boolean; version?: string; error?: string; durationMs: number }>;
        checkAuth: (config: unknown) => Promise<{ ok: boolean; durationMs: number; error?: string }>;
      },
      logger,
    };
  }

  const claudeConfig = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent")[
    "claude-code"
  ];
  const codexConfig = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent").codex;
  const cursorConfig = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent").cursor;

  describe("checkBinary", () => {
    it("returns ok:false on timeout", async () => {
      const { healthCheck } = makeHealthCheck(async () => okResult({ timedOut: true }));
      const result = await healthCheck.checkBinary(claudeConfig);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Timed out after");
    });

    it("returns ok:false with stderr snippet on non-zero exit", async () => {
      const { healthCheck } = makeHealthCheck(async () =>
        okResult({ exitCode: 127, stderr: "command not found: claude" }),
      );
      const result = await healthCheck.checkBinary(claudeConfig);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Exit code 127");
      expect(result.error).toContain("command not found: claude");
    });

    it("returns ok:false with the caught error's message when execute() throws", async () => {
      const { healthCheck } = makeHealthCheck(async () => {
        throw new Error("ENOENT: spawn claude");
      });
      const result = await healthCheck.checkBinary(claudeConfig);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("ENOENT: spawn claude");
    });

    it("returns ok:true with the trimmed first line of stdout as version on success", async () => {
      const { healthCheck } = makeHealthCheck(async () => okResult({ stdout: "  claude v2.5.0\nextra line\n" }));
      const result = await healthCheck.checkBinary(claudeConfig);
      expect(result.ok).toBe(true);
      expect(result.version).toBe("claude v2.5.0");
    });
  });

  describe("checkAuth — successPattern probe style (claude-code)", () => {
    it("passes when the pattern matches stdout+stderr", async () => {
      const { healthCheck } = makeHealthCheck(async () => okResult({ stdout: '{"loggedIn":  true}' }));
      const result = await healthCheck.checkAuth(claudeConfig);
      expect(result.ok).toBe(true);
    });

    it("fails when the pattern does not match", async () => {
      const { healthCheck } = makeHealthCheck(async () => okResult({ stdout: '{"loggedIn": false}' }));
      const result = await healthCheck.checkAuth(claudeConfig);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("expected pattern not found");
    });

    it("returns ok:false with the caught error's message when execute() throws", async () => {
      const { healthCheck } = makeHealthCheck(async () => {
        throw new Error("socket hang up");
      });
      const result = await healthCheck.checkAuth(claudeConfig);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("socket hang up");
    });

    it("returns ok:false on timeout", async () => {
      const { healthCheck } = makeHealthCheck(async () => okResult({ timedOut: true }));
      const result = await healthCheck.checkAuth(claudeConfig);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Auth probe timed out");
    });
  });

  describe("checkAuth — exitCodeOnly probe style (cursor)", () => {
    it("passes on exit code 0 regardless of output content", async () => {
      const { healthCheck } = makeHealthCheck(async () => okResult({ stdout: "whatever" }));
      const result = await healthCheck.checkAuth(cursorConfig);
      expect(result.ok).toBe(true);
    });

    it("fails on non-zero exit code", async () => {
      const { healthCheck } = makeHealthCheck(async () =>
        okResult({ exitCode: 1, stderr: "not logged in" }),
      );
      const result = await healthCheck.checkAuth(cursorConfig);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Exit code 1");
      expect(result.error).toContain("not logged in");
    });
  });

  describe("checkAuth — default PONG probe style (codex)", () => {
    it("passes when output contains PONG (case-insensitive) and exit code is 0", async () => {
      const { healthCheck } = makeHealthCheck(async () => okResult({ stdout: "pong" }));
      const result = await healthCheck.checkAuth(codexConfig);
      expect(result.ok).toBe(true);
    });

    it("passes when output contains PONG even if exit code is non-zero", async () => {
      const { healthCheck } = makeHealthCheck(async () => okResult({ exitCode: 3, stdout: "PONG" }));
      const result = await healthCheck.checkAuth(codexConfig);
      expect(result.ok).toBe(true);
    });

    it("fails with exit-code error when exit code is non-zero and PONG is absent", async () => {
      const { healthCheck } = makeHealthCheck(async () =>
        okResult({ exitCode: 1, stderr: "auth required" }),
      );
      const result = await healthCheck.checkAuth(codexConfig);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Exit code 1");
      expect(result.error).toContain("auth required");
    });

    it("fails with 'did not return expected response' when exit code is 0 but PONG is absent", async () => {
      const { healthCheck } = makeHealthCheck(async () => okResult({ stdout: "hello there" }));
      const result = await healthCheck.checkAuth(codexConfig);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("did not return expected response");
    });
  });
});
