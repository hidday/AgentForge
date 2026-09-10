import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { AGENT_STAGES, type AgentRuntime } from "../../src/domain/types.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeMockProcessRunner() {
  return { execute: vi.fn() };
}

function okResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    stdout: "1.2.3",
    stderr: "",
    exitCode: 0,
    durationMs: 5,
    timedOut: false,
    ...overrides,
  };
}

describe("RuntimeHealthCheck.getRequiredRuntimes()", () => {
  it("returns a non-empty set containing exactly the runtimes referenced by AGENT_STAGES", () => {
    const processRunner = makeMockProcessRunner();
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const required = check.getRequiredRuntimes();
    expect(required.size).toBeGreaterThan(0);

    const expected = new Set<AgentRuntime>(Object.values(AGENT_STAGES).map((s) => s.runtime));
    expect(required).toEqual(expected);
    // Sanity: from reading AGENT_STAGES this should include both claude-code and codex.
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
  });
});

describe("RuntimeHealthCheck.getLastResult()", () => {
  it("is undefined before runPreflight() and populated after", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockResolvedValue(okResult({ stdout: "1.0.0\npong" }));
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    expect(check.getLastResult()).toBeUndefined();

    // claude-code auth check needs the successPattern to match; codex needs pong.
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("status")) {
        return okResult({ stdout: '{"loggedIn": true}' });
      }
      return okResult({ stdout: "1.0.0\nPONG" });
    });

    await check.runPreflight();
    const result = check.getLastResult();
    expect(result).toBeDefined();
    expect(result?.ok).toBe(true);
  });
});

describe("RuntimeHealthCheck.runPreflight()", () => {
  it("resolves with ok:true when every required runtime's binary and auth checks pass", async () => {
    const processRunner = makeMockProcessRunner();
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    processRunner.execute.mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args.includes("--version")) return okResult({ stdout: "1.0.0" });
      if (opts.args.includes("status")) return okResult({ stdout: '{"loggedIn": true}' });
      // codex probe (pong path)
      return okResult({ stdout: "PONG" });
    });

    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
    expect(result.results.length).toBe(check.getRequiredRuntimes().size);
    for (const r of result.results) {
      expect(r.binaryCheck.ok).toBe(true);
      expect(r.authCheck.ok).toBe(true);
    }
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("throws a PreflightError carrying the PreflightResult when at least one runtime fails", async () => {
    const processRunner = makeMockProcessRunner();
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude") {
        // claude-code always fails its binary check
        return okResult({ exitCode: 1, stderr: "not found" });
      }
      if (opts.args.includes("--version")) return okResult({ stdout: "1.0.0" });
      return okResult({ stdout: "PONG" });
    });

    let caught: unknown;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PreflightError);
    const preflightErr = caught as PreflightError;
    expect(preflightErr.result.ok).toBe(false);
    const claudeResult = preflightErr.result.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);

    // Result is still stored via getLastResult even though runPreflight threw.
    expect(check.getLastResult()?.ok).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("lists skippedRuntimes as exactly the runtimes not in getRequiredRuntimes()", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return okResult({ stdout: "1.0.0" });
      if (opts.args.includes("status")) return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ stdout: "PONG" });
    });
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();
    const required = check.getRequiredRuntimes();
    const allRuntimes: AgentRuntime[] = ["claude-code", "codex", "cursor"];
    const expectedSkipped = allRuntimes.filter((r) => !required.has(r));
    expect(result.skippedRuntimes.sort()).toEqual(expectedSkipped.sort());
    // From AGENT_STAGES, cursor is never used, so it should be skipped.
    expect(result.skippedRuntimes).toContain("cursor");
    expect(result.requiredRuntimes).not.toContain("cursor");
  });
});

// AGENT_STAGES requires both claude-code and codex, so runtimeConfigs must
// supply a config for each even when a test only cares about claude-code's
// behavior. The stub codex config always succeeds via a distinct command
// name ("codex-stub"), routed by command name in the execute mock below --
// necessary because runPreflight probes required runtimes concurrently via
// Promise.all, so call order between runtimes is not guaranteed.
const STUB_CODEX_CONFIG = {
  command: "codex-stub",
  versionArgs: ["--version"],
  probeArgs: ["probe"],
  probeStdin: "ping",
};

function alwaysOkCodexHandler(opts: { command: string; args: string[] }): ProcessResult | undefined {
  if (opts.command !== "codex-stub") return undefined;
  return okResult({ stdout: opts.args.includes("--version") ? "1.0.0" : "pong" });
}

describe("RuntimeHealthCheck binary check (via runPreflight with a single-runtime config)", () => {
  function singleRuntimeCheck(claudeConfig: Record<string, unknown> = {}) {
    const processRunner = makeMockProcessRunner();
    const logger = makeMockLogger();
    const configs = {
      "claude-code": {
        command: "claude",
        versionArgs: ["--version"],
        probeArgs: ["auth", "status"],
        successPattern: '"loggedIn":\\s*true',
        ...claudeConfig,
      },
      codex: STUB_CODEX_CONFIG,
    } as never;
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    return { processRunner, logger, check };
  }

  it("binary check timing out yields ok:false with a 'Timed out' error", async () => {
    const { processRunner, check } = singleRuntimeCheck();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      const stub = alwaysOkCodexHandler(opts);
      if (stub) return stub;
      return okResult({ timedOut: true });
    });

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult();
    const r = result?.results.find((x) => x.runtime === "claude-code");
    expect(r?.binaryCheck.ok).toBe(false);
    expect(r?.binaryCheck.error).toMatch(/Timed out/);
    // Auth check should be skipped entirely -- claude's execute is called only once.
    const claudeCalls = processRunner.execute.mock.calls.filter(
      ([opts]: [{ command: string }]) => opts.command === "claude",
    );
    expect(claudeCalls.length).toBe(1);
    expect(r?.authCheck).toEqual({
      ok: false,
      durationMs: 0,
      error: "Skipped: binary check failed",
    });
  });

  it("binary check non-zero exit yields ok:false with exit code and truncated stderr", async () => {
    const { processRunner, check } = singleRuntimeCheck();
    const longStderr = "e".repeat(300);
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      const stub = alwaysOkCodexHandler(opts);
      if (stub) return stub;
      return okResult({ exitCode: 7, stderr: longStderr });
    });

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const r = check.getLastResult()?.results.find((x) => x.runtime === "claude-code");
    expect(r?.binaryCheck.ok).toBe(false);
    expect(r?.binaryCheck.error).toContain("Exit code 7");
    expect(r?.binaryCheck.error).toContain("e".repeat(200));
    expect(r?.binaryCheck.error?.length).toBeLessThan(longStderr.length + 30);
    const claudeCalls = processRunner.execute.mock.calls.filter(
      ([opts]: [{ command: string }]) => opts.command === "claude",
    );
    expect(claudeCalls.length).toBe(1);
  });

  it("binary check success parses version from the first line, truncated to 100 chars", async () => {
    const { processRunner, check } = singleRuntimeCheck();
    const longFirstLine = "v" + "x".repeat(150);
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      const stub = alwaysOkCodexHandler(opts);
      if (stub) return stub;
      if (opts.args.includes("--version")) {
        return okResult({ stdout: `${longFirstLine}\nsecond line` });
      }
      return okResult({ stdout: '{"loggedIn": true}' });
    });

    const result = await check.runPreflight();
    const r = result.results.find((x) => x.runtime === "claude-code");
    expect(r?.binaryCheck.ok).toBe(true);
    expect(r?.binaryCheck.version).toBe(longFirstLine.slice(0, 100));
    expect(r?.binaryCheck.version?.length).toBe(100);
  });

  it("processRunner.execute rejecting during binary check is caught and reported as a failure", async () => {
    const { processRunner, check } = singleRuntimeCheck();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      const stub = alwaysOkCodexHandler(opts);
      if (stub) return stub;
      throw new Error("spawn ENOENT");
    });

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const r = check.getLastResult()?.results.find((x) => x.runtime === "claude-code");
    expect(r?.binaryCheck.ok).toBe(false);
    expect(r?.binaryCheck.error).toBe("spawn ENOENT");
  });

  it("processRunner.execute rejecting with a non-Error value is stringified", async () => {
    const { processRunner, check } = singleRuntimeCheck();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      const stub = alwaysOkCodexHandler(opts);
      if (stub) return stub;
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "plain string failure";
    });

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const r = check.getLastResult()?.results.find((x) => x.runtime === "claude-code");
    expect(r?.binaryCheck.ok).toBe(false);
    expect(r?.binaryCheck.error).toBe("plain string failure");
  });
});

describe("RuntimeHealthCheck auth check branches", () => {
  function checkWithConfig(config: Record<string, unknown>) {
    const processRunner = makeMockProcessRunner();
    const logger = makeMockLogger();
    const configs = {
      "claude-code": {
        command: "claude",
        versionArgs: ["--version"],
        probeArgs: ["probe"],
        ...config,
      },
      codex: STUB_CODEX_CONFIG,
    } as never;
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    return { processRunner, logger, check };
  }

  it("auth probe timing out yields ok:false with a timeout message", async () => {
    const { processRunner, check } = checkWithConfig({});
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      const stub = alwaysOkCodexHandler(opts);
      if (stub) return stub;
      if (opts.args.includes("--version")) return okResult(); // binary check ok
      return okResult({ timedOut: true }); // auth check times out
    });

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const r = check.getLastResult()?.results.find((x) => x.runtime === "claude-code");
    expect(r?.authCheck.ok).toBe(false);
    expect(r?.authCheck.error).toMatch(/timed out/i);
  });

  describe("successPattern branch", () => {
    it("passes when the pattern matches stdout", async () => {
      const { processRunner, check } = checkWithConfig({ successPattern: '"loggedIn":\\s*true' });
      processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
        const stub = alwaysOkCodexHandler(opts);
        if (stub) return stub;
        if (opts.args.includes("--version")) return okResult();
        return okResult({ stdout: '{"loggedIn": true}' });
      });

      const result = await check.runPreflight();
      const r = result.results.find((x) => x.runtime === "claude-code");
      expect(r?.authCheck.ok).toBe(true);
    });

    it("fails with 'expected pattern not found' when the pattern does not match", async () => {
      const { processRunner, check } = checkWithConfig({ successPattern: '"loggedIn":\\s*true' });
      processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
        const stub = alwaysOkCodexHandler(opts);
        if (stub) return stub;
        if (opts.args.includes("--version")) return okResult();
        return okResult({ stdout: '{"loggedIn": false}' });
      });

      await expect(check.runPreflight()).rejects.toThrow(PreflightError);
      const r = check.getLastResult()?.results.find((x) => x.runtime === "claude-code");
      expect(r?.authCheck.ok).toBe(false);
      expect(r?.authCheck.error).toContain("expected pattern not found");
    });
  });

  describe("exitCodeOnly branch", () => {
    it("passes on exit code 0 alone", async () => {
      const { processRunner, check } = checkWithConfig({ exitCodeOnly: true });
      processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
        const stub = alwaysOkCodexHandler(opts);
        if (stub) return stub;
        if (opts.args.includes("--version")) return okResult();
        return okResult({ exitCode: 0, stdout: "irrelevant garbage" });
      });

      const result = await check.runPreflight();
      const r = result.results.find((x) => x.runtime === "claude-code");
      expect(r?.authCheck.ok).toBe(true);
    });

    it("fails on non-zero exit code with an exit-code message", async () => {
      const { processRunner, check } = checkWithConfig({ exitCodeOnly: true });
      processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
        const stub = alwaysOkCodexHandler(opts);
        if (stub) return stub;
        if (opts.args.includes("--version")) return okResult();
        return okResult({ exitCode: 2, stderr: "auth expired" });
      });

      await expect(check.runPreflight()).rejects.toThrow(PreflightError);
      const r = check.getLastResult()?.results.find((x) => x.runtime === "claude-code");
      expect(r?.authCheck.ok).toBe(false);
      expect(r?.authCheck.error).toContain("Exit code 2");
      expect(r?.authCheck.error).toContain("auth expired");
    });

    it("falls back to stdout in the error message when stderr is empty", async () => {
      const { processRunner, check } = checkWithConfig({ exitCodeOnly: true });
      processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
        const stub = alwaysOkCodexHandler(opts);
        if (stub) return stub;
        if (opts.args.includes("--version")) return okResult();
        return okResult({ exitCode: 5, stderr: "", stdout: "reason from stdout" });
      });

      await expect(check.runPreflight()).rejects.toThrow(PreflightError);
      const r = check.getLastResult()?.results.find((x) => x.runtime === "claude-code");
      expect(r?.authCheck.ok).toBe(false);
      expect(r?.authCheck.error).toContain("Exit code 5");
      expect(r?.authCheck.error).toContain("reason from stdout");
    });
  });

  describe("default PONG-echo branch (neither successPattern nor exitCodeOnly)", () => {
    it("passes when stdout/stderr contains 'pong' case-insensitively with exit 0", async () => {
      const { processRunner, check } = checkWithConfig({});
      processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
        const stub = alwaysOkCodexHandler(opts);
        if (stub) return stub;
        if (opts.args.includes("--version")) return okResult();
        return okResult({ exitCode: 0, stdout: "reply: PoNg" });
      });

      const result = await check.runPreflight();
      const r = result.results.find((x) => x.runtime === "claude-code");
      expect(r?.authCheck.ok).toBe(true);
    });

    it("still passes when exit code is nonzero but pong IS found (non-fatal exit failure)", async () => {
      const { processRunner, check } = checkWithConfig({});
      processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
        const stub = alwaysOkCodexHandler(opts);
        if (stub) return stub;
        if (opts.args.includes("--version")) return okResult();
        return okResult({ exitCode: 1, stdout: "", stderr: "warning\npong" });
      });

      const result = await check.runPreflight();
      const r = result.results.find((x) => x.runtime === "claude-code");
      expect(r?.authCheck.ok).toBe(true);
    });

    it("fails with an exit-code message when exit is nonzero and pong is NOT found", async () => {
      const { processRunner, check } = checkWithConfig({});
      processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
        const stub = alwaysOkCodexHandler(opts);
        if (stub) return stub;
        if (opts.args.includes("--version")) return okResult();
        return okResult({ exitCode: 1, stdout: "", stderr: "boom" });
      });

      await expect(check.runPreflight()).rejects.toThrow(PreflightError);
      const r = check.getLastResult()?.results.find((x) => x.runtime === "claude-code");
      expect(r?.authCheck.ok).toBe(false);
      expect(r?.authCheck.error).toContain("Exit code 1");
      expect(r?.authCheck.error).toContain("boom");
    });

    it("fails with an unexpected-response message when exit is 0 but pong is NOT found", async () => {
      const { processRunner, check } = checkWithConfig({});
      processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
        const stub = alwaysOkCodexHandler(opts);
        if (stub) return stub;
        if (opts.args.includes("--version")) return okResult();
        return okResult({ exitCode: 0, stdout: "no marker here" });
      });

      await expect(check.runPreflight()).rejects.toThrow(PreflightError);
      const r = check.getLastResult()?.results.find((x) => x.runtime === "claude-code");
      expect(r?.authCheck.ok).toBe(false);
      expect(r?.authCheck.error).toContain("did not return expected response");
    });
  });

  it("processRunner.execute rejecting during auth check is caught, ok:false", async () => {
    const { processRunner, check } = checkWithConfig({});
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      const stub = alwaysOkCodexHandler(opts);
      if (stub) return stub;
      if (opts.args.includes("--version")) return okResult();
      throw new Error("connection reset");
    });

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const r = check.getLastResult()?.results.find((x) => x.runtime === "claude-code");
    expect(r?.authCheck.ok).toBe(false);
    expect(r?.authCheck.error).toBe("connection reset");
  });

  it("processRunner.execute rejecting with a non-Error value during auth check is stringified", async () => {
    const { processRunner, check } = checkWithConfig({});
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      const stub = alwaysOkCodexHandler(opts);
      if (stub) return stub;
      if (opts.args.includes("--version")) return okResult();
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "auth plain failure";
    });

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const r = check.getLastResult()?.results.find((x) => x.runtime === "claude-code");
    expect(r?.authCheck.ok).toBe(false);
    expect(r?.authCheck.error).toBe("auth plain failure");
  });
});

describe("RuntimeHealthCheck.buildRuntimeConfigs()", () => {
  it("produces real-world-shaped configs that route to the expected auth-check branches", async () => {
    const processRunner = makeMockProcessRunner();
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--print"],
      "codex",
      ["exec", "-"],
      "agent",
    );

    expect(configs["claude-code"].successPattern).toBe('"loggedIn":\\s*true');
    expect(configs.codex.probeStdin).toBe("Respond with exactly: PONG");
    expect(configs.cursor.exitCodeOnly).toBe(true);

    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return okResult({ stdout: "1.0.0" });
      if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      if (opts.command === "codex") return okResult({ stdout: "PONG" });
      if (opts.command === "agent") return okResult({ exitCode: 0 });
      throw new Error(`unexpected command ${opts.command}`);
    });

    const result = await check.runPreflight();
    // Only claude-code and codex are required per AGENT_STAGES; cursor is skipped.
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"].sort());
    expect(result.ok).toBe(true);
  });
});
