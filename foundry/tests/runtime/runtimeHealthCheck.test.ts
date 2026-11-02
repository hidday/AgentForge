import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 5, timedOut: false, ...overrides };
}

function makeConfigs() {
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
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    },
    cursor: {
      command: "agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    },
  };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds configs for all three runtimes with the expected auth strategy", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    expect(configs["claude-code"].successPattern).toBeDefined();
    expect(configs.codex.probeStdin).toContain("PONG");
    expect(configs.cursor.exitCodeOnly).toBe(true);
  });
});

describe("RuntimeHealthCheck", () => {
  let logger: ReturnType<typeof makeLogger>;
  let processRunner: { execute: ReturnType<typeof vi.fn> };
  let hc: RuntimeHealthCheck;

  beforeEach(() => {
    logger = makeLogger();
    processRunner = { execute: vi.fn() };
    hc = new RuntimeHealthCheck(processRunner as never, makeConfigs() as never, logger as never);
  });

  it("getRequiredRuntimes returns only the runtimes used by a configured agent stage", () => {
    const required = hc.getRequiredRuntimes();
    expect(required).toEqual(new Set(["claude-code", "codex"]));
  });

  it("getLastResult is undefined before any preflight has run", () => {
    expect(hc.getLastResult()).toBeUndefined();
  });

  describe("runPreflight", () => {
    it("passes and records skipped runtimes when binary and auth checks succeed", async () => {
      processRunner.execute.mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeResult({ stdout: "1.2.3\n" }));
        }
        if (opts.command === "claude") {
          return Promise.resolve(makeResult({ stdout: '{"loggedIn": true}' }));
        }
        return Promise.resolve(makeResult({ stdout: "PONG" }));
      });

      const result = await hc.runPreflight();

      expect(result.ok).toBe(true);
      expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
      expect(result.skippedRuntimes).toEqual(["cursor"]);
      expect(hc.getLastResult()).toBe(result);
      expect(logger.info).toHaveBeenCalledWith(
        expect.anything(),
        "Preflight passed: all agent runtimes are accessible and authenticated",
      );
    });

    it("fails and throws PreflightError when a runtime fails its auth check", async () => {
      processRunner.execute.mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeResult({ stdout: "1.2.3\n" }));
        }
        if (opts.command === "claude") {
          return Promise.resolve(makeResult({ stdout: '{"loggedIn": false}' }));
        }
        return Promise.resolve(makeResult({ stdout: "PONG" }));
      });

      await expect(hc.runPreflight()).rejects.toThrow(PreflightError);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          failures: expect.arrayContaining([expect.objectContaining({ runtime: "claude-code" })]),
        }),
        "Preflight FAILED: one or more agent runtimes are not ready",
      );
      expect(hc.getLastResult()?.ok).toBe(false);
    });

    it("skips the auth check and reports a skip reason when the binary check fails", async () => {
      processRunner.execute.mockImplementation((opts: { args: string[] }) => {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeResult({ exitCode: 127, stderr: "command not found" }));
        }
        return Promise.resolve(makeResult({ stdout: "PONG" }));
      });

      const err = await hc.runPreflight().catch((e) => e as PreflightError);
      expect(err).toBeInstanceOf(PreflightError);
      const claudeResult = err.result.results.find((r) => r.runtime === "claude-code");
      expect(claudeResult?.binaryCheck.ok).toBe(false);
      expect(claudeResult?.authCheck.ok).toBe(false);
      expect(claudeResult?.authCheck.error).toBe("Skipped: binary check failed");
    });
  });

  describe("checkBinary (via probeRuntime)", () => {
    it("reports a timeout", async () => {
      processRunner.execute.mockResolvedValue(makeResult({ timedOut: true }));
      const result = await (hc as unknown as {
        probeRuntime: (r: string) => Promise<{ binaryCheck: { ok: boolean; error?: string } }>;
      }).probeRuntime("cursor");
      expect(result.binaryCheck.ok).toBe(false);
      expect(result.binaryCheck.error).toContain("Timed out after");
    });

    it("reports a non-zero exit code", async () => {
      processRunner.execute.mockResolvedValue(
        makeResult({ exitCode: 1, stderr: "not found" }),
      );
      const result = await (hc as unknown as {
        probeRuntime: (r: string) => Promise<{ binaryCheck: { ok: boolean; error?: string } }>;
      }).probeRuntime("cursor");
      expect(result.binaryCheck.ok).toBe(false);
      expect(result.binaryCheck.error).toContain("Exit code 1");
    });

    it("captures the version string from the first line of stdout", async () => {
      processRunner.execute.mockResolvedValue(makeResult({ stdout: "v2.0.0\nextra line" }));
      const result = await (hc as unknown as {
        probeRuntime: (
          r: string,
        ) => Promise<{ binaryCheck: { ok: boolean; version?: string }; authCheck: { ok: boolean } }>;
      }).probeRuntime("cursor");
      expect(result.binaryCheck.ok).toBe(true);
      expect(result.binaryCheck.version).toBe("v2.0.0");
    });

    it("reports an error when the process runner throws", async () => {
      processRunner.execute.mockRejectedValue(new Error("spawn failed"));
      const result = await (hc as unknown as {
        probeRuntime: (r: string) => Promise<{ binaryCheck: { ok: boolean; error?: string } }>;
      }).probeRuntime("cursor");
      expect(result.binaryCheck.ok).toBe(false);
      expect(result.binaryCheck.error).toBe("spawn failed");
    });
  });

  describe("checkAuth (via probeRuntime)", () => {
    function mockBinaryThenAuth(authResult: ProcessResult) {
      processRunner.execute.mockImplementation((opts: { args: string[] }) => {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeResult({ stdout: "1.0.0" }));
        }
        return Promise.resolve(authResult);
      });
    }

    it("times out", async () => {
      mockBinaryThenAuth(makeResult({ timedOut: true }));
      const result = await (hc as unknown as {
        probeRuntime: (r: string) => Promise<{ authCheck: { ok: boolean; error?: string } }>;
      }).probeRuntime("cursor");
      expect(result.authCheck.ok).toBe(false);
      expect(result.authCheck.error).toContain("Auth probe timed out");
    });

    it("passes via successPattern match", async () => {
      mockBinaryThenAuth(makeResult({ stdout: '{"loggedIn": true}' }));
      const result = await (hc as unknown as {
        probeRuntime: (r: string) => Promise<{ authCheck: { ok: boolean } }>;
      }).probeRuntime("claude-code");
      expect(result.authCheck.ok).toBe(true);
    });

    it("fails via successPattern mismatch", async () => {
      mockBinaryThenAuth(makeResult({ stdout: '{"loggedIn": false}' }));
      const result = await (hc as unknown as {
        probeRuntime: (r: string) => Promise<{ authCheck: { ok: boolean; error?: string } }>;
      }).probeRuntime("claude-code");
      expect(result.authCheck.ok).toBe(false);
      expect(result.authCheck.error).toContain("expected pattern not found");
    });

    it("exitCodeOnly passes on exit code 0", async () => {
      mockBinaryThenAuth(makeResult({ exitCode: 0 }));
      const result = await (hc as unknown as {
        probeRuntime: (r: string) => Promise<{ authCheck: { ok: boolean } }>;
      }).probeRuntime("cursor");
      expect(result.authCheck.ok).toBe(true);
    });

    it("exitCodeOnly fails on a non-zero exit code", async () => {
      mockBinaryThenAuth(makeResult({ exitCode: 2, stderr: "not logged in" }));
      const result = await (hc as unknown as {
        probeRuntime: (r: string) => Promise<{ authCheck: { ok: boolean; error?: string } }>;
      }).probeRuntime("cursor");
      expect(result.authCheck.ok).toBe(false);
      expect(result.authCheck.error).toContain("Exit code 2");
    });

    it("pong-style probe passes when exit code is 0 and output contains PONG", async () => {
      mockBinaryThenAuth(makeResult({ exitCode: 0, stdout: "PONG" }));
      const result = await (hc as unknown as {
        probeRuntime: (r: string) => Promise<{ authCheck: { ok: boolean } }>;
      }).probeRuntime("codex");
      expect(result.authCheck.ok).toBe(true);
    });

    it("pong-style probe passes even with a non-zero exit code, as long as PONG is present", async () => {
      mockBinaryThenAuth(makeResult({ exitCode: 1, stdout: "PONG", stderr: "warning" }));
      const result = await (hc as unknown as {
        probeRuntime: (r: string) => Promise<{ authCheck: { ok: boolean } }>;
      }).probeRuntime("codex");
      expect(result.authCheck.ok).toBe(true);
    });

    it("pong-style probe fails on non-zero exit code without PONG", async () => {
      mockBinaryThenAuth(makeResult({ exitCode: 1, stderr: "boom" }));
      const result = await (hc as unknown as {
        probeRuntime: (r: string) => Promise<{ authCheck: { ok: boolean; error?: string } }>;
      }).probeRuntime("codex");
      expect(result.authCheck.ok).toBe(false);
      expect(result.authCheck.error).toContain("Exit code 1");
    });

    it("pong-style probe fails on exit code 0 without PONG in the output", async () => {
      mockBinaryThenAuth(makeResult({ exitCode: 0, stdout: "nothing useful" }));
      const result = await (hc as unknown as {
        probeRuntime: (r: string) => Promise<{ authCheck: { ok: boolean; error?: string } }>;
      }).probeRuntime("codex");
      expect(result.authCheck.ok).toBe(false);
      expect(result.authCheck.error).toContain("did not return expected response");
    });

    it("reports an error when the process runner throws during the auth probe", async () => {
      processRunner.execute.mockImplementation((opts: { args: string[] }) => {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeResult({ stdout: "1.0.0" }));
        }
        return Promise.reject(new Error("auth probe crashed"));
      });
      const result = await (hc as unknown as {
        probeRuntime: (r: string) => Promise<{ authCheck: { ok: boolean; error?: string } }>;
      }).probeRuntime("cursor");
      expect(result.authCheck.ok).toBe(false);
      expect(result.authCheck.error).toBe("auth probe crashed");
    });
  });
});
