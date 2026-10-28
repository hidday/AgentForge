import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessRunner } from "../../src/runtime/processRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  child: () => noopLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function result(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 1, timedOut: false, ...overrides };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds the expected per-runtime probe configuration", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--print"],
      "codex",
      ["exec", "-"],
      "agent",
    );

    expect(configs["claude-code"]).toMatchObject({ command: "claude", probeArgs: ["auth", "status"] });
    expect(configs.codex).toMatchObject({ command: "codex", probeStdin: "Respond with exactly: PONG" });
    expect(configs.cursor).toMatchObject({ command: "agent", exitCodeOnly: true });
  });
});

describe("RuntimeHealthCheck", () => {
  let execute: ReturnType<typeof vi.fn>;
  let processRunner: ProcessRunner;
  let configs: ReturnType<typeof RuntimeHealthCheck.buildRuntimeConfigs>;
  let healthCheck: RuntimeHealthCheck;

  beforeEach(() => {
    execute = vi.fn();
    processRunner = { execute } as unknown as ProcessRunner;
    configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--print"],
      "codex",
      ["exec", "-"],
      "agent",
    );
    healthCheck = new RuntimeHealthCheck(processRunner, configs, noopLogger);
    vi.clearAllMocks();
  });

  describe("getRequiredRuntimes / getLastResult", () => {
    it("derives required runtimes from AGENT_STAGES (claude-code and codex, not cursor)", () => {
      const required = healthCheck.getRequiredRuntimes();
      expect(required.has("claude-code")).toBe(true);
      expect(required.has("codex")).toBe(true);
      expect(required.has("cursor")).toBe(false);
    });

    it("returns undefined before any preflight has run", () => {
      expect(healthCheck.getLastResult()).toBeUndefined();
    });
  });

  describe("runPreflight", () => {
    it("passes when all required runtimes have a healthy binary and auth check", async () => {
      execute.mockImplementation(async (opts) => {
        if (opts.args.includes("--version")) return result({ stdout: "1.2.3\n" });
        if (opts.args.includes("auth")) return result({ stdout: '{"loggedIn": true}' });
        // codex probe via stdin
        return result({ stdout: "PONG" });
      });

      const summary = await healthCheck.runPreflight();

      expect(summary.ok).toBe(true);
      expect(summary.skippedRuntimes).toEqual(["cursor"]);
      expect(summary.results).toHaveLength(2);
      expect(healthCheck.getLastResult()).toBe(summary);
    });

    it("fails and throws PreflightError when a binary check fails", async () => {
      execute.mockImplementation(async (opts) => {
        if (opts.command === "claude" && opts.args.includes("--version")) {
          return result({ exitCode: 1, stderr: "not found" });
        }
        if (opts.args.includes("--version")) return result({ stdout: "1.0.0" });
        if (opts.args.includes("auth")) return result({ stdout: '{"loggedIn": true}' });
        return result({ stdout: "PONG" });
      });

      await expect(healthCheck.runPreflight()).rejects.toThrow(PreflightError);
      const last = healthCheck.getLastResult();
      expect(last?.ok).toBe(false);
      const claude = last?.results.find((r) => r.runtime === "claude-code");
      expect(claude?.binaryCheck.ok).toBe(false);
      expect(claude?.authCheck.ok).toBe(false);
      expect(claude?.authCheck.error).toContain("Skipped");
    });

    it("fails when the binary check times out", async () => {
      execute.mockImplementation(async (opts) => {
        if (opts.command === "claude" && opts.args.includes("--version")) {
          return result({ timedOut: true });
        }
        if (opts.args.includes("--version")) return result({ stdout: "1.0.0" });
        if (opts.args.includes("auth")) return result({ stdout: '{"loggedIn": true}' });
        return result({ stdout: "PONG" });
      });

      await expect(healthCheck.runPreflight()).rejects.toThrow(PreflightError);
      const claude = healthCheck.getLastResult()?.results.find((r) => r.runtime === "claude-code");
      expect(claude?.binaryCheck.error).toMatch(/Timed out/);
    });

    it("fails when the binary check throws", async () => {
      execute.mockImplementation(async (opts) => {
        if (opts.command === "claude" && opts.args.includes("--version")) {
          throw new Error("spawn failed");
        }
        if (opts.args.includes("--version")) return result({ stdout: "1.0.0" });
        if (opts.args.includes("auth")) return result({ stdout: '{"loggedIn": true}' });
        return result({ stdout: "PONG" });
      });

      await expect(healthCheck.runPreflight()).rejects.toThrow(PreflightError);
      const claude = healthCheck.getLastResult()?.results.find((r) => r.runtime === "claude-code");
      expect(claude?.binaryCheck.error).toBe("spawn failed");
    });

    it("fails when the auth success pattern does not match (claude-code)", async () => {
      execute.mockImplementation(async (opts) => {
        if (opts.args.includes("--version")) return result({ stdout: "1.0.0" });
        if (opts.command === "claude" && opts.args.includes("auth")) {
          return result({ stdout: '{"loggedIn": false}' });
        }
        if (opts.args.includes("auth")) return result({ stdout: '{"loggedIn": true}' });
        return result({ stdout: "PONG" });
      });

      await expect(healthCheck.runPreflight()).rejects.toThrow(PreflightError);
      const claude = healthCheck.getLastResult()?.results.find((r) => r.runtime === "claude-code");
      expect(claude?.authCheck.ok).toBe(false);
      expect(claude?.authCheck.error).toMatch(/expected pattern not found/);
    });

    it("fails when the auth probe times out", async () => {
      execute.mockImplementation(async (opts) => {
        if (opts.args.includes("--version")) return result({ stdout: "1.0.0" });
        if (opts.command === "claude" && opts.args.includes("auth")) {
          return result({ timedOut: true });
        }
        if (opts.args.includes("auth")) return result({ stdout: '{"loggedIn": true}' });
        return result({ stdout: "PONG" });
      });

      await expect(healthCheck.runPreflight()).rejects.toThrow(PreflightError);
      const claude = healthCheck.getLastResult()?.results.find((r) => r.runtime === "claude-code");
      expect(claude?.authCheck.error).toMatch(/Auth probe timed out/);
    });

    it("fails when a pong-based auth probe (codex) returns a non-zero exit and no pong", async () => {
      execute.mockImplementation(async (opts) => {
        if (opts.args.includes("--version")) return result({ stdout: "1.0.0" });
        if (opts.command === "claude" && opts.args.includes("auth")) {
          return result({ stdout: '{"loggedIn": true}' });
        }
        // codex probe
        return result({ exitCode: 1, stderr: "nope" });
      });

      await expect(healthCheck.runPreflight()).rejects.toThrow(PreflightError);
      const codex = healthCheck.getLastResult()?.results.find((r) => r.runtime === "codex");
      expect(codex?.authCheck.ok).toBe(false);
      expect(codex?.authCheck.error).toMatch(/Exit code 1/);
    });

    it("succeeds for a pong-based auth probe when exit is non-zero but pong is present", async () => {
      execute.mockImplementation(async (opts) => {
        if (opts.args.includes("--version")) return result({ stdout: "1.0.0" });
        if (opts.command === "claude" && opts.args.includes("auth")) {
          return result({ stdout: '{"loggedIn": true}' });
        }
        return result({ exitCode: 1, stdout: "PONG" });
      });

      const summary = await healthCheck.runPreflight();
      expect(summary.ok).toBe(true);
    });

    it("fails when a pong-based auth probe exits 0 but never returns pong", async () => {
      execute.mockImplementation(async (opts) => {
        if (opts.args.includes("--version")) return result({ stdout: "1.0.0" });
        if (opts.command === "claude" && opts.args.includes("auth")) {
          return result({ stdout: '{"loggedIn": true}' });
        }
        return result({ exitCode: 0, stdout: "nothing useful" });
      });

      await expect(healthCheck.runPreflight()).rejects.toThrow(PreflightError);
      const codex = healthCheck.getLastResult()?.results.find((r) => r.runtime === "codex");
      expect(codex?.authCheck.error).toMatch(/did not return expected response/);
    });

    it("fails when the auth check throws", async () => {
      execute.mockImplementation(async (opts) => {
        if (opts.args.includes("--version")) return result({ stdout: "1.0.0" });
        if (opts.command === "claude" && opts.args.includes("auth")) {
          throw new Error("network down");
        }
        return result({ stdout: "PONG" });
      });

      await expect(healthCheck.runPreflight()).rejects.toThrow(PreflightError);
      const claude = healthCheck.getLastResult()?.results.find((r) => r.runtime === "claude-code");
      expect(claude?.authCheck.error).toBe("network down");
    });

    it("exercises the exitCodeOnly auth path when cursor is explicitly required", async () => {
      const cursorOnlyHealthCheck = new RuntimeHealthCheck(
        processRunner,
        configs,
        noopLogger,
      );
      vi.spyOn(cursorOnlyHealthCheck, "getRequiredRuntimes").mockReturnValue(new Set(["cursor"]));

      execute.mockImplementation(async (opts) => {
        if (opts.args.includes("--version")) return result({ stdout: "1.0.0" });
        return result({ exitCode: 0 });
      });

      const summary = await cursorOnlyHealthCheck.runPreflight();
      expect(summary.ok).toBe(true);
      expect(summary.requiredRuntimes).toEqual(["cursor"]);
    });

    it("fails the exitCodeOnly auth path on a non-zero exit", async () => {
      const cursorOnlyHealthCheck = new RuntimeHealthCheck(processRunner, configs, noopLogger);
      vi.spyOn(cursorOnlyHealthCheck, "getRequiredRuntimes").mockReturnValue(new Set(["cursor"]));

      execute.mockImplementation(async (opts) => {
        if (opts.args.includes("--version")) return result({ stdout: "1.0.0" });
        return result({ exitCode: 1, stderr: "denied" });
      });

      await expect(cursorOnlyHealthCheck.runPreflight()).rejects.toThrow(PreflightError);
    });
  });
});
