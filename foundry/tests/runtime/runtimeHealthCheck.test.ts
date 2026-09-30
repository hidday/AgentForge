import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeProcessRunner() {
  return { execute: vi.fn() };
}

const configs = RuntimeHealthCheck.buildRuntimeConfigs(
  "claude",
  [],
  "codex",
  ["exec", "-"],
  "cursor-agent",
);

function ok(stdout: string, overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout, stderr: "", exitCode: 0, durationMs: 5, timedOut: false, ...overrides };
}

function fail(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: "", stderr: "boom", exitCode: 1, durationMs: 5, timedOut: false, ...overrides };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds a config per runtime with the expected commands and probe shapes", () => {
    expect(configs["claude-code"].command).toBe("claude");
    expect(configs["claude-code"].probeArgs).toEqual(["auth", "status"]);
    expect(configs["claude-code"].successPattern).toBeDefined();

    expect(configs.codex.command).toBe("codex");
    expect(configs.codex.probeArgs).toEqual(["exec", "-"]);
    expect(configs.codex.probeStdin).toBe("Respond with exactly: PONG");

    expect(configs.cursor.command).toBe("cursor-agent");
    expect(configs.cursor.probeArgs).toEqual(["status"]);
    expect(configs.cursor.exitCodeOnly).toBe(true);
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes", () => {
  it("returns the distinct set of runtimes used across AGENT_STAGES", () => {
    const processRunner = makeProcessRunner();
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
    const required = check.getRequiredRuntimes();
    expect(required).toEqual(new Set<AgentRuntime>(["claude-code", "codex"]));
  });
});

describe("RuntimeHealthCheck.getLastResult", () => {
  it("returns undefined before any preflight has run", () => {
    const processRunner = makeProcessRunner();
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
    expect(check.getLastResult()).toBeUndefined();
  });

  it("returns the most recent preflight result after a run", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue(ok("v1.0.0"));
    // Force a passing auth check via the successPattern branch for claude-code
    // and PONG branch for codex by controlling call sequence below instead.
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return ok("v1.0.0");
      if (opts.args.includes("auth")) return ok('{"loggedIn": true}');
      return ok("PONG");
    });

    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    const result = await check.runPreflight();

    expect(check.getLastResult()).toBe(result);
    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });
});

describe("RuntimeHealthCheck.runPreflight — success and failure paths", () => {
  it("throws PreflightError and logs failures when a binary check fails", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.command === "claude" && opts.args.includes("--version")) {
        return fail({ stderr: "command not found" });
      }
      if (opts.args.includes("--version")) return ok("v1.0.0");
      return ok("PONG");
    });

    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ runtime: "claude-code", binaryError: expect.any(String) }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );

    // authCheck should have been skipped once binaryCheck failed
    const lastResult = check.getLastResult();
    const claudeResult = lastResult?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toBe("Skipped: binary check failed");
  });

  it("marks binary check as timed out when the version probe times out", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) {
        return { stdout: "", stderr: "", exitCode: 1, durationMs: 5000, timedOut: true };
      }
      return ok("PONG");
    });

    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toContain("Timed out after");
  });

  it("catches a thrown error from processRunner.execute during the binary check", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) {
        throw new Error("spawn ENOENT");
      }
      return ok("PONG");
    });

    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toBe("spawn ENOENT");
  });

  it("catches a non-Error throw from processRunner.execute during the binary check", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "raw string failure";
      }
      return ok("PONG");
    });

    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.error).toBe("raw string failure");
  });

  it("succeeds using the successPattern branch for claude-code auth", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args.includes("--version")) return ok(`${opts.command} v1.0.0`);
      if (opts.command === "claude") return ok('{"loggedIn": true, "other": 1}');
      return ok("PONG");
    });

    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });

  it("fails the successPattern branch when the pattern does not match", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args.includes("--version")) return ok("v1.0.0");
      if (opts.command === "claude") return ok('{"loggedIn": false}');
      return ok("PONG");
    });

    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("expected pattern not found");
  });

  it("marks auth check as timed out when the probe times out", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args.includes("--version")) return ok("v1.0.0");
      return { stdout: "", stderr: "", exitCode: 1, durationMs: 30000, timedOut: true };
    });

    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("Auth probe timed out after");
  });

  it("catches a thrown error during the auth check", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args.includes("--version")) return ok("v1.0.0");
      throw new Error("auth probe crashed");
    });

    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.error).toBe("auth probe crashed");
  });

  it("succeeds using the PONG branch for codex", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args.includes("--version")) return ok("v1.0.0");
      if (opts.command === "codex") return ok("some preamble\npong\n");
      return ok('{"loggedIn": true}');
    });

    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });

  it("fails the PONG branch on non-zero exit without a pong in the output", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args.includes("--version")) return ok("v1.0.0");
      if (opts.command === "codex") return fail({ stderr: "connection refused" });
      return ok('{"loggedIn": true}');
    });

    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("Exit code 1");
    expect(codexResult?.authCheck.error).toContain("connection refused");
  });

  it("fails the PONG branch when exit code is 0 but no pong is present", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args.includes("--version")) return ok("v1.0.0");
      if (opts.command === "codex") return ok("hello there, no magic word");
      return ok('{"loggedIn": true}');
    });

    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("did not return expected response");
  });

  it("fails the exitCodeOnly branch (cursor) on non-zero exit", async () => {
    // Force cursor to be required by using a health check whose required-set
    // detection is stubbed via a custom instance covering all three runtimes.
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return ok("v1.0.0");
      if (opts.command === "cursor-agent") return fail({ stderr: "not logged in" });
      return ok('{"loggedIn": true}');
    });

    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    vi.spyOn(check, "getRequiredRuntimes").mockReturnValue(
      new Set<AgentRuntime>(["claude-code", "codex", "cursor"]),
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const cursorResult = check.getLastResult()?.results.find((r) => r.runtime === "cursor");
    expect(cursorResult?.authCheck.ok).toBe(false);
    expect(cursorResult?.authCheck.error).toContain("Exit code 1");
    expect(cursorResult?.authCheck.error).toContain("not logged in");
  });

  it("succeeds the exitCodeOnly branch (cursor) on zero exit with no pattern needed", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return ok("v1.0.0");
      if (opts.command === "cursor-agent") return ok("status: fine");
      if (opts.command === "codex") return ok("PONG");
      return ok('{"loggedIn": true}');
    });

    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    vi.spyOn(check, "getRequiredRuntimes").mockReturnValue(
      new Set<AgentRuntime>(["claude-code", "codex", "cursor"]),
    );

    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
    const cursorResult = result.results.find((r) => r.runtime === "cursor");
    expect(cursorResult?.authCheck.ok).toBe(true);
  });

  it("reports a non-zero exit code for the binary check with a truncated stderr", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args.includes("--version")) {
        return fail({ stderr: "y".repeat(300) });
      }
      if (opts.args.includes("--version")) return ok("v1.0.0");
      return ok('{"loggedIn": true}');
    });

    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.error).toContain("Exit code 1");
    // stderr slice is capped at 200 chars inside the error message
    expect(claudeResult?.binaryCheck.error?.length).toBeLessThan(300);
  });

  it("truncates a long version string to 100 characters", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return ok(`v${"1".repeat(200)}\nextra line`);
      if (opts.command === "codex") return ok("PONG");
      return ok('{"loggedIn": true}');
    });

    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    const result = await check.runPreflight();
    const claudeResult = result.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.version?.length).toBe(100);
    expect(claudeResult?.binaryCheck.version).not.toContain("extra line");
  });
});
