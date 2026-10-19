import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 10,
    timedOut: false,
    ...overrides,
  };
}

const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "cursor");

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds a config entry for every runtime with the given commands", () => {
    expect(configs["claude-code"].command).toBe("claude");
    expect(configs.codex.command).toBe("codex");
    expect(configs.cursor.command).toBe("cursor");
  });

  it("configures claude-code with a successPattern auth check (no exitCodeOnly)", () => {
    expect(configs["claude-code"].successPattern).toBeDefined();
    expect(configs["claude-code"].exitCodeOnly).toBeUndefined();
  });

  it("configures cursor with exitCodeOnly auth check (no successPattern)", () => {
    expect(configs.cursor.exitCodeOnly).toBe(true);
    expect(configs.cursor.successPattern).toBeUndefined();
  });

  it("configures codex with a PONG probeStdin and no successPattern/exitCodeOnly", () => {
    expect(configs.codex.probeStdin).toContain("PONG");
    expect(configs.codex.successPattern).toBeUndefined();
    expect(configs.codex.exitCodeOnly).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes", () => {
  it("returns the runtimes actually referenced by configured agent stages (claude-code and codex, but not cursor)", () => {
    const logger = makeLogger();
    const check = new RuntimeHealthCheck({ execute: vi.fn() } as never, configs, logger as never);
    const required = check.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });
});

describe("RuntimeHealthCheck.getLastResult", () => {
  it("returns undefined before runPreflight has ever run", () => {
    const logger = makeLogger();
    const check = new RuntimeHealthCheck({ execute: vi.fn() } as never, configs, logger as never);
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight", () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  it("resolves ok=true, caches the result, and lists cursor as skipped (not required)", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return makeResult({ stdout: "v1.0.0\n" });
      if (opts.args.includes("auth")) return makeResult({ stdout: '{"loggedIn": true}' }); // claude-code
      return makeResult({ stdout: "PONG" }); // codex
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toContain("cursor");
    expect(result.results.length).toBe(2);
    expect(check.getLastResult()).toBe(result);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("throws PreflightError and logs failures when a binary check fails (non-zero exit)", async () => {
    const execute = vi.fn().mockResolvedValue(makeResult({ exitCode: 127, stderr: "not found" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ failures: expect.any(Array) }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("skips the auth check and reports it failed when the binary check fails", async () => {
    const execute = vi.fn().mockResolvedValue(makeResult({ exitCode: 1, stderr: "boom" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    try {
      await check.runPreflight();
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightError);
      const summary = (err as PreflightError).result;
      for (const r of summary.results) {
        expect(r.authCheck.ok).toBe(false);
        expect(r.authCheck.error).toContain("Skipped");
      }
    }
  });

  it("reports a binary check as failed with a 'Timed out' message when the version probe times out", async () => {
    const execute = vi.fn().mockResolvedValue(makeResult({ timedOut: true }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    try {
      await check.runPreflight();
      expect.fail("expected throw");
    } catch (err) {
      const summary = (err as PreflightError).result;
      expect(summary.results[0]!.binaryCheck.ok).toBe(false);
      expect(summary.results[0]!.binaryCheck.error).toContain("Timed out");
    }
  });
});

// The private checkBinary/checkAuth probes contain branches (notably cursor's
// exitCodeOnly path) that are unreachable via runPreflight() because "cursor"
// never appears in AGENT_STAGES and is therefore always skipped. We exercise
// those branches directly to get real behavioral coverage of each outcome.
describe("RuntimeHealthCheck private probes (direct)", () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  it("checkBinary: reports ok=false with the caught error message when execute() rejects", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("ENOENT: spawn failed"));
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (check as any).checkBinary(configs["claude-code"]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("ENOENT: spawn failed");
  });

  it("checkAuth (exitCodeOnly=true): passes on exit code 0 regardless of output content", async () => {
    const execute = vi.fn().mockResolvedValue(makeResult({ exitCode: 0, stdout: "anything" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (check as any).checkAuth(configs.cursor);
    expect(result.ok).toBe(true);
  });

  it("checkAuth (exitCodeOnly=true): fails with the exit code and stderr/stdout snippet on non-zero exit", async () => {
    const execute = vi.fn().mockResolvedValue(makeResult({ exitCode: 2, stderr: "bad" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (check as any).checkAuth(configs.cursor);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Exit code 2");
    expect(result.error).toContain("bad");
  });

  it("checkAuth (exitCodeOnly=true): times out distinctly from a failed exit code", async () => {
    const execute = vi.fn().mockResolvedValue(makeResult({ timedOut: true }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (check as any).checkAuth(configs.cursor);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("checkAuth (successPattern): fails when the pattern does not match stdout or stderr", async () => {
    const execute = vi.fn().mockResolvedValue(makeResult({ stdout: '{"loggedIn": false}' }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (check as any).checkAuth(configs["claude-code"]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("expected pattern not found");
  });

  it("checkAuth (successPattern): passes when the pattern matches, even on a non-zero exit code", async () => {
    const execute = vi.fn().mockResolvedValue(
      makeResult({ exitCode: 1, stdout: '{"loggedIn": true}' }),
    );
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (check as any).checkAuth(configs["claude-code"]);
    expect(result.ok).toBe(true);
  });

  it("checkAuth (default PONG heuristic): fails on non-zero exit when no 'pong' text is present", async () => {
    const execute = vi.fn().mockResolvedValue(makeResult({ exitCode: 1, stdout: "garbage" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (check as any).checkAuth(configs.codex);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Exit code 1");
  });

  it("checkAuth (default PONG heuristic): passes on non-zero exit if a 'pong' response is present", async () => {
    const execute = vi.fn().mockResolvedValue(makeResult({ exitCode: 1, stdout: "PONG" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (check as any).checkAuth(configs.codex);
    expect(result.ok).toBe(true);
  });

  it("checkAuth (default PONG heuristic): fails on exit code 0 if no 'pong' response is present", async () => {
    const execute = vi.fn().mockResolvedValue(makeResult({ exitCode: 0, stdout: "nothing useful" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (check as any).checkAuth(configs.codex);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("did not return expected response");
  });

  it("checkAuth: reports ok=false with the caught error message when execute() rejects", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (check as any).checkAuth(configs.codex);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("ECONNREFUSED");
  });

  it("probeRuntime: skips the auth probe entirely when the binary check fails", async () => {
    const execute = vi.fn().mockResolvedValue(makeResult({ exitCode: 1 }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (check as any).probeRuntime("cursor");
    expect(result.binaryCheck.ok).toBe(false);
    expect(result.authCheck.ok).toBe(false);
    expect(result.authCheck.error).toContain("Skipped");
    // Only one execute() call — the version probe — since auth was skipped.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("probeRuntime: runs the auth probe after a successful binary check", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return makeResult({ stdout: "v1" });
      return makeResult({ exitCode: 0 });
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (check as any).probeRuntime("cursor");
    expect(result.binaryCheck.ok).toBe(true);
    expect(result.authCheck.ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
