import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeConfigs() {
  return RuntimeHealthCheck.buildRuntimeConfigs(
    "claude",
    ["--print"],
    "codex",
    ["exec", "-"],
    "agent",
  );
}

function makeResult(overrides: Partial<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> = {}) {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 1, timedOut: false, ...overrides };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds configs for all three runtimes with their distinct probe strategies", () => {
    const configs = makeConfigs();
    expect(configs["claude-code"].successPattern).toBeDefined();
    expect(configs.codex.probeStdin).toBe("Respond with exactly: PONG");
    expect(configs.cursor.exitCodeOnly).toBe(true);
  });
});

describe("RuntimeHealthCheck", () => {
  describe("getRequiredRuntimes", () => {
    it("returns the distinct runtimes used by configured agent stages", () => {
      const health = new RuntimeHealthCheck({} as never, makeConfigs(), makeLogger() as never);
      const required = health.getRequiredRuntimes();
      expect(required).toEqual(new Set<AgentRuntime>(["claude-code", "codex"]));
    });
  });

  describe("getLastResult", () => {
    it("is undefined before runPreflight has ever run", () => {
      const health = new RuntimeHealthCheck({} as never, makeConfigs(), makeLogger() as never);
      expect(health.getLastResult()).toBeUndefined();
    });
  });

  describe("runPreflight", () => {
    it("passes and caches the result when all required runtimes are healthy", async () => {
      const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version") return Promise.resolve(makeResult({ stdout: "v1.0.0" }));
        if (opts.command === "claude") {
          return Promise.resolve(makeResult({ stdout: '{"loggedIn": true}' }));
        }
        return Promise.resolve(makeResult({ stdout: "PONG" }));
      });
      const processRunner = { execute };
      const health = new RuntimeHealthCheck(processRunner as never, makeConfigs(), makeLogger() as never);

      const result = await health.runPreflight();

      expect(result.ok).toBe(true);
      expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
      expect(result.skippedRuntimes).toEqual(["cursor"]);
      expect(health.getLastResult()).toBe(result);
    });

    it("throws PreflightError when a runtime's binary check fails", async () => {
      const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.command === "claude" && opts.args[0] === "--version") {
          return Promise.resolve(makeResult({ exitCode: 1, stderr: "command not found" }));
        }
        if (opts.args[0] === "--version") return Promise.resolve(makeResult({ stdout: "v1.0.0" }));
        return Promise.resolve(makeResult({ stdout: "PONG" }));
      });
      const logger = makeLogger();
      const health = new RuntimeHealthCheck(
        { execute } as never,
        makeConfigs(),
        logger as never,
      );

      await expect(health.runPreflight()).rejects.toThrow(PreflightError);
      expect(logger.error).toHaveBeenCalled();

      const claudeResult = health.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
      expect(claudeResult.binaryCheck.ok).toBe(false);
      expect(claudeResult.authCheck.ok).toBe(false);
      expect(claudeResult.authCheck.error).toContain("Skipped");
    });

    it("throws PreflightError when a runtime's auth check fails despite a healthy binary", async () => {
      const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version") return Promise.resolve(makeResult({ stdout: "v1.0.0" }));
        if (opts.command === "claude") {
          return Promise.resolve(makeResult({ stdout: '{"loggedIn": false}' }));
        }
        return Promise.resolve(makeResult({ stdout: "PONG" }));
      });
      const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger() as never);

      await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    });
  });

  describe("checkBinary (via probeRuntime through runPreflight)", () => {
    it("treats a timed-out version check as a binary failure", async () => {
      const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
        if (opts.args[0] === "--version") return Promise.resolve(makeResult({ timedOut: true }));
        return Promise.resolve(makeResult({ stdout: "PONG" }));
      });
      const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger() as never);

      await expect(health.runPreflight()).rejects.toThrow(PreflightError);
      const claudeResult = health.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
      expect(claudeResult.binaryCheck.error).toContain("Timed out");
    });

    it("captures a thrown error from the process runner as a binary check failure", async () => {
      const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
        if (opts.args[0] === "--version") return Promise.reject(new Error("ENOENT"));
        return Promise.resolve(makeResult({ stdout: "PONG" }));
      });
      const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger() as never);

      await expect(health.runPreflight()).rejects.toThrow(PreflightError);
      const claudeResult = health.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
      expect(claudeResult.binaryCheck.error).toBe("ENOENT");
    });
  });

  describe("checkAuth branches (via codex's PONG-based probe)", () => {
    function buildHealthWithCodexAuth(codexResult: ReturnType<typeof makeResult>) {
      const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version") return Promise.resolve(makeResult({ stdout: "v1" }));
        if (opts.command === "claude") return Promise.resolve(makeResult({ stdout: '{"loggedIn": true}' }));
        return Promise.resolve(codexResult);
      });
      return new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger() as never);
    }

    it("passes when the output contains PONG even with a non-zero exit code", async () => {
      const health = buildHealthWithCodexAuth(makeResult({ stdout: "noise PONG noise", exitCode: 1 }));
      const result = await health.runPreflight();
      expect(result.ok).toBe(true);
    });

    it("fails with the exit code error when there is no PONG and exit code is non-zero", async () => {
      const health = buildHealthWithCodexAuth(makeResult({ exitCode: 2, stderr: "auth error" }));
      await expect(health.runPreflight()).rejects.toThrow(PreflightError);
      const codexResult = health.getLastResult()!.results.find((r) => r.runtime === "codex")!;
      expect(codexResult.authCheck.error).toContain("Exit code 2");
    });

    it("fails with an unexpected-response error when exit code is 0 but there is no PONG", async () => {
      const health = buildHealthWithCodexAuth(makeResult({ exitCode: 0, stdout: "nothing useful" }));
      await expect(health.runPreflight()).rejects.toThrow(PreflightError);
      const codexResult = health.getLastResult()!.results.find((r) => r.runtime === "codex")!;
      expect(codexResult.authCheck.error).toContain("did not return expected response");
    });

    it("reports a timeout on the auth probe distinctly from a binary timeout", async () => {
      const health = buildHealthWithCodexAuth(makeResult({ timedOut: true }));
      await expect(health.runPreflight()).rejects.toThrow(PreflightError);
      const codexResult = health.getLastResult()!.results.find((r) => r.runtime === "codex")!;
      expect(codexResult.authCheck.error).toContain("Auth probe timed out");
    });

    it("captures a thrown error during the auth probe", async () => {
      const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version") return Promise.resolve(makeResult({ stdout: "v1" }));
        if (opts.command === "claude") return Promise.resolve(makeResult({ stdout: '{"loggedIn": true}' }));
        return Promise.reject(new Error("network down"));
      });
      const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger() as never);

      await expect(health.runPreflight()).rejects.toThrow(PreflightError);
      const codexResult = health.getLastResult()!.results.find((r) => r.runtime === "codex")!;
      expect(codexResult.authCheck.error).toBe("network down");
    });
  });

  describe("checkAuth with exitCodeOnly (cursor-style config, probed directly)", () => {
    it("passes on exit code 0 regardless of output content", async () => {
      // Exercise the exitCodeOnly branch directly since cursor isn't in the required set.
      const configs = makeConfigs();
      const execute = vi.fn().mockResolvedValue(makeResult({ exitCode: 0, stdout: "anything" }));
      const health = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);

      const probeRuntime = (
        health as unknown as {
          probeRuntime: (r: AgentRuntime) => Promise<{ authCheck: { ok: boolean } }>;
        }
      ).probeRuntime.bind(health);

      const result = await probeRuntime("cursor");
      expect(result.authCheck.ok).toBe(true);
    });

    it("fails on a non-zero exit code", async () => {
      const configs = makeConfigs();
      const execute = vi.fn().mockImplementation((opts: { args: string[] }) =>
        opts.args[0] === "--version"
          ? Promise.resolve(makeResult({ stdout: "v1" }))
          : Promise.resolve(makeResult({ exitCode: 1, stderr: "not logged in" })),
      );
      const health = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);

      const probeRuntime = (
        health as unknown as {
          probeRuntime: (r: AgentRuntime) => Promise<{ authCheck: { ok: boolean; error?: string } }>;
        }
      ).probeRuntime.bind(health);

      const result = await probeRuntime("cursor");
      expect(result.authCheck.ok).toBe(false);
      expect(result.authCheck.error).toContain("not logged in");
    });
  });
});
