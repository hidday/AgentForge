import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeResult(overrides: Partial<{
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}> = {}) {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 5,
    timedOut: false,
    ...overrides,
  };
}

describe("RuntimeHealthCheck", () => {
  let processRunner: { execute: ReturnType<typeof vi.fn> };
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    processRunner = { execute: vi.fn() };
    logger = makeLogger();
  });

  function buildConfigs() {
    return RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec"], "agent");
  }

  describe("buildRuntimeConfigs", () => {
    it("builds configs for all three runtimes with the expected probe strategy", () => {
      const configs = buildConfigs();
      expect(configs["claude-code"].successPattern).toContain("loggedIn");
      expect(configs.codex.probeStdin).toBe("Respond with exactly: PONG");
      expect(configs.cursor.exitCodeOnly).toBe(true);
    });
  });

  describe("getRequiredRuntimes", () => {
    it("derives the set of runtimes actually used by AGENT_STAGES", () => {
      const check = new RuntimeHealthCheck(processRunner as never, buildConfigs(), logger as never);
      const required = check.getRequiredRuntimes();
      expect(required.has("claude-code")).toBe(true);
      expect(required.has("codex")).toBe(true);
      expect(required.has("cursor")).toBe(false);
    });
  });

  describe("getLastResult", () => {
    it("returns undefined before runPreflight has ever run", () => {
      const check = new RuntimeHealthCheck(processRunner as never, buildConfigs(), logger as never);
      expect(check.getLastResult()).toBeUndefined();
    });
  });

  describe("runPreflight", () => {
    it("resolves ok=true and caches the result when binary + auth checks pass for all required runtimes", async () => {
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return makeResult({ stdout: "v1.2.3\n" });
        }
        if (opts.args.includes("status")) {
          return makeResult({ stdout: '{"loggedIn": true}' });
        }
        return makeResult({ stdout: "PONG" });
      });

      const check = new RuntimeHealthCheck(processRunner as never, buildConfigs(), logger as never);
      const result = await check.runPreflight();

      expect(result.ok).toBe(true);
      expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
      expect(result.skippedRuntimes).toEqual(["cursor"]);
      expect(check.getLastResult()).toBe(result);
      expect(logger.info).toHaveBeenCalledWith(
        expect.anything(),
        "Preflight passed: all agent runtimes are accessible and authenticated",
      );
    });

    it("throws PreflightError carrying the failure summary when a binary check fails", async () => {
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return makeResult({ exitCode: 127, stderr: "command not found" });
        }
        return makeResult({ stdout: "PONG" });
      });

      const check = new RuntimeHealthCheck(processRunner as never, buildConfigs(), logger as never);

      await expect(check.runPreflight()).rejects.toThrow(PreflightError);
      try {
        await check.runPreflight();
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(PreflightError);
        const preflightErr = err as PreflightError;
        expect(preflightErr.result.ok).toBe(false);
        const claudeResult = preflightErr.result.results.find((r) => r.runtime === "claude-code")!;
        expect(claudeResult.binaryCheck.ok).toBe(false);
        expect(claudeResult.authCheck.ok).toBe(false);
        expect(claudeResult.authCheck.error).toContain("Skipped");
      }
      expect(logger.error).toHaveBeenCalled();
    });

    it("marks binary check as timed out when the version probe times out", async () => {
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return makeResult({ timedOut: true });
        }
        return makeResult({ stdout: "PONG" });
      });

      const check = new RuntimeHealthCheck(processRunner as never, buildConfigs(), logger as never);
      await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    });

    it("catches a thrown error from processRunner.execute during the binary check", async () => {
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          throw new Error("spawn EACCES");
        }
        return makeResult({ stdout: "PONG" });
      });

      const check = new RuntimeHealthCheck(processRunner as never, buildConfigs(), logger as never);
      try {
        await check.runPreflight();
        expect.unreachable();
      } catch (err) {
        const preflightErr = err as PreflightError;
        const claudeResult = preflightErr.result.results.find((r) => r.runtime === "claude-code")!;
        expect(claudeResult.binaryCheck.error).toBe("spawn EACCES");
      }
    });

    it("fails the auth check when successPattern does not match the probe output", async () => {
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return makeResult({ stdout: "v1" });
        }
        if (opts.args.includes("status") && opts.args.includes("auth")) {
          return makeResult({ stdout: '{"loggedIn": false}' });
        }
        return makeResult({ stdout: "PONG" });
      });

      const check = new RuntimeHealthCheck(processRunner as never, buildConfigs(), logger as never);
      try {
        await check.runPreflight();
        expect.unreachable();
      } catch (err) {
        const preflightErr = err as PreflightError;
        const claudeResult = preflightErr.result.results.find((r) => r.runtime === "claude-code")!;
        expect(claudeResult.authCheck.ok).toBe(false);
        expect(claudeResult.authCheck.error).toContain("expected pattern not found");
      }
    });

    it("fails the auth check on auth-probe timeout", async () => {
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return makeResult({ stdout: "v1" });
        }
        return makeResult({ timedOut: true });
      });

      const check = new RuntimeHealthCheck(processRunner as never, buildConfigs(), logger as never);
      try {
        await check.runPreflight();
        expect.unreachable();
      } catch (err) {
        const preflightErr = err as PreflightError;
        const codexResult = preflightErr.result.results.find((r) => r.runtime === "codex")!;
        expect(codexResult.authCheck.ok).toBe(false);
        expect(codexResult.authCheck.error).toContain("timed out");
      }
    });

    it("catches a thrown error from processRunner.execute during the auth check", async () => {
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return makeResult({ stdout: "v1" });
        }
        throw new Error("ECONNRESET");
      });

      const check = new RuntimeHealthCheck(processRunner as never, buildConfigs(), logger as never);
      try {
        await check.runPreflight();
        expect.unreachable();
      } catch (err) {
        const preflightErr = err as PreflightError;
        const codexResult = preflightErr.result.results.find((r) => r.runtime === "codex")!;
        expect(codexResult.authCheck.error).toBe("ECONNRESET");
      }
    });

    it("fails a binary check with a non-zero exit code (not a timeout)", async () => {
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return makeResult({ exitCode: 2, stderr: "bad flag" });
        }
        return makeResult({ stdout: "PONG" });
      });

      const check = new RuntimeHealthCheck(processRunner as never, buildConfigs(), logger as never);
      try {
        await check.runPreflight();
        expect.unreachable();
      } catch (err) {
        const preflightErr = err as PreflightError;
        const claudeResult = preflightErr.result.results.find((r) => r.runtime === "claude-code")!;
        expect(claudeResult.binaryCheck.ok).toBe(false);
        expect(claudeResult.binaryCheck.error).toContain("Exit code 2");
      }
    });

    it("exitCodeOnly auth probe (cursor): passes on exit 0 and fails on non-zero exit, independent of pattern matching", async () => {
      // cursor is never a required runtime (AGENT_STAGES only routes to claude-code/codex),
      // so exercise its exitCodeOnly branch directly via the private checkAuth method.
      const configs = buildConfigs();
      const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
      const checkAuth = (check as unknown as {
        checkAuth: (config: (typeof configs)["cursor"]) => Promise<{ ok: boolean; error?: string }>;
      }).checkAuth.bind(check);

      processRunner.execute.mockResolvedValueOnce(makeResult({ exitCode: 0, stdout: "ready" }));
      const okResult = await checkAuth(configs.cursor);
      expect(okResult.ok).toBe(true);

      processRunner.execute.mockResolvedValueOnce(makeResult({ exitCode: 1, stderr: "not logged in" }));
      const failResult = await checkAuth(configs.cursor);
      expect(failResult.ok).toBe(false);
      expect(failResult.error).toContain("not logged in");
    });

    it("falls back to a case-insensitive PONG match for the generic auth probe path", async () => {
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return makeResult({ stdout: "v1" });
        }
        return makeResult({ stdout: "pong\n", exitCode: 0 });
      });

      const check = new RuntimeHealthCheck(processRunner as never, buildConfigs(), logger as never);
      const result = await check.runPreflight();
      const codexResult = result.results.find((r) => r.runtime === "codex")!;
      expect(codexResult.authCheck.ok).toBe(true);
    });

    it("fails the generic auth probe when exit code is non-zero and no PONG is present", async () => {
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return makeResult({ stdout: "v1" });
        }
        return makeResult({ stdout: "", stderr: "boom", exitCode: 1 });
      });

      const check = new RuntimeHealthCheck(processRunner as never, buildConfigs(), logger as never);
      try {
        await check.runPreflight();
        expect.unreachable();
      } catch (err) {
        const preflightErr = err as PreflightError;
        const codexResult = preflightErr.result.results.find((r) => r.runtime === "codex")!;
        expect(codexResult.authCheck.error).toContain("Exit code 1");
      }
    });

    it("fails the generic auth probe when exit code is 0 but no PONG is present in output", async () => {
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return makeResult({ stdout: "v1" });
        }
        return makeResult({ stdout: "unexpected reply", exitCode: 0 });
      });

      const check = new RuntimeHealthCheck(processRunner as never, buildConfigs(), logger as never);
      try {
        await check.runPreflight();
        expect.unreachable();
      } catch (err) {
        const preflightErr = err as PreflightError;
        const codexResult = preflightErr.result.results.find((r) => r.runtime === "codex")!;
        expect(codexResult.authCheck.error).toContain("did not return expected response");
      }
    });
  });
});
