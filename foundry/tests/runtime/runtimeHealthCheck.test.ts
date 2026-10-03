import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck, type RuntimeProbeResult } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult, ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function okResult(stdout: string, overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout, stderr: "", exitCode: 0, durationMs: 5, timedOut: false, ...overrides };
}

describe("RuntimeHealthCheck.getRequiredRuntimes / getLastResult", () => {
  it("requires exactly the runtimes used by AGENT_STAGES (claude-code, codex) and skips the rest", async () => {
    const processRunner = { execute: vi.fn() };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    const required = check.getRequiredRuntimes();
    expect(required).toEqual(new Set(["claude-code", "codex"]));
  });

  it("getLastResult() is undefined before any preflight has run", () => {
    const processRunner = { execute: vi.fn() };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight", () => {
  it("resolves ok:true and records skippedRuntimes=['cursor'] when every required runtime passes", async () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const logger = makeMockLogger();
    const processRunner = {
      execute: vi.fn(async (opts: ProcessSpawnOptions): Promise<ProcessResult> => {
        if (opts.args[0] === "--version") return okResult(`${opts.command} v1.0.0`);
        if (opts.command === "claude") return okResult('{"loggedIn": true}');
        // codex default probe: success requires "pong" in output
        return okResult("PONG");
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(check.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("throws PreflightError and logs failures when a runtime's auth check fails", async () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const logger = makeMockLogger();
    const processRunner = {
      execute: vi.fn(async (opts: ProcessSpawnOptions): Promise<ProcessResult> => {
        if (opts.args[0] === "--version") return okResult(`${opts.command} v1.0.0`);
        if (opts.command === "claude") return okResult('{"loggedIn": true}');
        // codex auth probe never returns PONG -> auth check fails
        return okResult("nothing useful", { exitCode: 1, stderr: "connection refused" });
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    try {
      await check.runPreflight();
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightError);
      const preflightErr = err as PreflightError;
      expect(preflightErr.result.ok).toBe(false);
      const codexResult = preflightErr.result.results.find((r) => r.runtime === "codex");
      expect(codexResult?.authCheck.ok).toBe(false);
    }

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ failures: expect.any(Array) }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
    // lastResult is still recorded even though runPreflight() throws.
    expect(check.getLastResult()?.ok).toBe(false);
  });

  it("skips the auth check entirely when the binary check fails", async () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const logger = makeMockLogger();
    const processRunner = {
      execute: vi.fn(async (opts: ProcessSpawnOptions): Promise<ProcessResult> => {
        if (opts.command === "claude" && opts.args[0] === "--version") {
          return okResult("", { exitCode: 127, stderr: "command not found" });
        }
        if (opts.args[0] === "--version") return okResult(`${opts.command} v1.0.0`);
        return okResult("PONG");
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const claudeCalls = processRunner.execute.mock.calls.filter(
      ([opts]) => (opts as ProcessSpawnOptions).command === "claude",
    );
    // Only the binary (--version) check should have run for claude-code —
    // the auth probe must be skipped once the binary check fails.
    expect(claudeCalls).toHaveLength(1);
  });

  it("reports a binary check timeout distinctly from a non-zero exit", async () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const logger = makeMockLogger();
    const processRunner = {
      execute: vi.fn(async (opts: ProcessSpawnOptions): Promise<ProcessResult> => {
        if (opts.command === "claude" && opts.args[0] === "--version") {
          return { stdout: "", stderr: "", exitCode: 0, durationMs: 5000, timedOut: true };
        }
        if (opts.args[0] === "--version") return okResult(`${opts.command} v1.0.0`);
        return okResult("PONG");
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const err = await check.runPreflight().catch((e) => e as PreflightError);
    expect(err).toBeInstanceOf(PreflightError);
    const claudeResult = (err as PreflightError).result.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toContain("Timed out after");
  });

  it("surfaces a thrown error from processRunner.execute as a binaryCheck failure", async () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const logger = makeMockLogger();
    const processRunner = {
      execute: vi.fn(async (opts: ProcessSpawnOptions): Promise<ProcessResult> => {
        if (opts.command === "claude" && opts.args[0] === "--version") {
          throw new Error("ENOENT: spawn failed");
        }
        if (opts.args[0] === "--version") return okResult(`${opts.command} v1.0.0`);
        return okResult("PONG");
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const err = await check.runPreflight().catch((e) => e as PreflightError);
    const claudeResult = (err as PreflightError).result.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toBe("ENOENT: spawn failed");
  });
});

// The following exercise checkBinary/checkAuth branches directly via
// probeRuntime, which is the only way to reach the `cursor` config's
// exitCodeOnly path (cursor is never in AGENT_STAGES so runPreflight()
// never probes it).
describe("RuntimeHealthCheck private probe branches (via probeRuntime)", () => {
  function buildCheck(execute: (opts: ProcessSpawnOptions) => Promise<ProcessResult>) {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const logger = makeMockLogger();
    const processRunner = { execute: vi.fn(execute) };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    return {
      check,
      logger,
      processRunner,
      probe: (runtime: AgentRuntime): Promise<RuntimeProbeResult> =>
        (check as unknown as { probeRuntime(r: AgentRuntime): Promise<RuntimeProbeResult> }).probeRuntime(
          runtime,
        ),
    };
  }

  it("cursor: exitCodeOnly auth check passes on exit code 0", async () => {
    const { probe } = buildCheck(async (opts) => {
      if (opts.args[0] === "--version") return okResult("agent v2");
      return okResult("", { exitCode: 0 });
    });

    const result = await probe("cursor");
    expect(result.authCheck.ok).toBe(true);
  });

  it("cursor: exitCodeOnly auth check fails on non-zero exit code", async () => {
    const { probe } = buildCheck(async (opts) => {
      if (opts.args[0] === "--version") return okResult("agent v2");
      return okResult("", { exitCode: 1, stderr: "not logged in" });
    });

    const result = await probe("cursor");
    expect(result.authCheck.ok).toBe(false);
    expect(result.authCheck.error).toContain("Exit code 1");
    expect(result.authCheck.error).toContain("not logged in");
  });

  it("cursor: exitCodeOnly auth check reports a timeout", async () => {
    const { probe } = buildCheck(async (opts) => {
      if (opts.args[0] === "--version") return okResult("agent v2");
      return { stdout: "", stderr: "", exitCode: 0, durationMs: 1, timedOut: true };
    });

    const result = await probe("cursor");
    expect(result.authCheck.ok).toBe(false);
    expect(result.authCheck.error).toContain("Auth probe timed out");
  });

  it("claude-code: successPattern mismatch fails the auth check even on exit code 0", async () => {
    const { probe } = buildCheck(async (opts) => {
      if (opts.args[0] === "--version") return okResult("claude v1");
      return okResult('{"loggedIn": false}');
    });

    const result = await probe("claude-code");
    expect(result.authCheck.ok).toBe(false);
    expect(result.authCheck.error).toContain("expected pattern not found");
  });

  it("codex (default pattern): a PONG response is treated as success even with a non-zero exit code", async () => {
    const { probe } = buildCheck(async (opts) => {
      if (opts.args[0] === "--version") return okResult("codex v1");
      return okResult("noise PONG noise", { exitCode: 1 });
    });

    const result = await probe("codex");
    expect(result.authCheck.ok).toBe(true);
  });

  it("codex (default pattern): exit code 0 without a PONG in the output fails the auth check", async () => {
    const { probe } = buildCheck(async (opts) => {
      if (opts.args[0] === "--version") return okResult("codex v1");
      return okResult("no response token here", { exitCode: 0 });
    });

    const result = await probe("codex");
    expect(result.authCheck.ok).toBe(false);
    expect(result.authCheck.error).toContain("did not return expected response");
  });

  it("codex (default pattern): non-zero exit with no PONG fails with the exit-code error", async () => {
    const { probe } = buildCheck(async (opts) => {
      if (opts.args[0] === "--version") return okResult("codex v1");
      return okResult("", { exitCode: 2, stderr: "boom" });
    });

    const result = await probe("codex");
    expect(result.authCheck.ok).toBe(false);
    expect(result.authCheck.error).toContain("Exit code 2");
    expect(result.authCheck.error).toContain("boom");
  });

  it("checkAuth catches a thrown error from processRunner.execute", async () => {
    const { probe } = buildCheck(async (opts) => {
      if (opts.args[0] === "--version") return okResult("codex v1");
      throw new Error("auth probe crashed");
    });

    const result = await probe("codex");
    expect(result.authCheck.ok).toBe(false);
    expect(result.authCheck.error).toBe("auth probe crashed");
  });
});
