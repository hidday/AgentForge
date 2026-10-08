import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 1, timedOut: false, ...overrides };
}

function makeConfigs() {
  return RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds configs for claude-code with a successPattern auth check", () => {
    const configs = makeConfigs();
    expect(configs["claude-code"]).toMatchObject({
      command: "claude",
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });
  });

  it("builds configs for codex with a stdin-based PONG probe", () => {
    const configs = makeConfigs();
    expect(configs.codex).toMatchObject({
      command: "codex",
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });
  });

  it("builds configs for cursor with an exit-code-only auth check", () => {
    const configs = makeConfigs();
    expect(configs.cursor).toMatchObject({
      command: "agent",
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes", () => {
  it("returns the distinct set of runtimes used by any agent stage", () => {
    const health = new RuntimeHealthCheck({ execute: vi.fn() } as never, makeConfigs(), makeLogger() as never);
    const required = health.getRequiredRuntimes();
    expect(required).toEqual(new Set(["claude-code", "codex"]));
  });
});

describe("RuntimeHealthCheck.getLastResult", () => {
  it("is undefined before any preflight has run", () => {
    const health = new RuntimeHealthCheck({ execute: vi.fn() } as never, makeConfigs(), makeLogger() as never);
    expect(health.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight", () => {
  it("resolves ok:true when every required runtime's binary and auth checks pass", async () => {
    const execute = vi.fn().mockImplementation(({ command, args }: { command: string; args: string[] }) => {
      if (args.includes("--version")) return Promise.resolve(makeResult({ stdout: "1.0.0\n" }));
      if (command === "claude") return Promise.resolve(makeResult({ stdout: '{"loggedIn": true}' }));
      if (command === "codex") return Promise.resolve(makeResult({ stdout: "PONG" }));
      return Promise.resolve(makeResult());
    });
    const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger() as never);

    const result = await health.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(health.getLastResult()).toBe(result);
  });

  it("throws PreflightError with per-runtime failure details when a binary check fails", async () => {
    const logger = makeLogger();
    const execute = vi.fn().mockImplementation(({ command, args }: { command: string; args: string[] }) => {
      if (command === "claude" && args.includes("--version")) {
        return Promise.resolve(makeResult({ exitCode: 127, stderr: "command not found" }));
      }
      if (args.includes("--version")) return Promise.resolve(makeResult({ stdout: "1.0.0" }));
      if (command === "codex") return Promise.resolve(makeResult({ stdout: "PONG" }));
      return Promise.resolve(makeResult());
    });
    const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), logger as never);

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: [expect.objectContaining({ runtime: "claude-code" })],
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("skips the auth check and reports it failed when the binary check itself fails", async () => {
    const execute = vi.fn().mockImplementation(({ args }: { args: string[] }) => {
      if (args.includes("--version")) return Promise.resolve(makeResult({ exitCode: 1, stderr: "nope" }));
      return Promise.resolve(makeResult());
    });
    const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger() as never);

    let caught: PreflightError | undefined;
    try {
      await health.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }

    expect(caught).toBeInstanceOf(PreflightError);
    const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck).toEqual({ ok: false, durationMs: 0, error: "Skipped: binary check failed" });
  });

  it("marks binary check timed out distinctly from a non-zero exit", async () => {
    const execute = vi.fn().mockImplementation(({ args }: { args: string[] }) => {
      if (args.includes("--version")) return Promise.resolve(makeResult({ timedOut: true }));
      return Promise.resolve(makeResult());
    });
    const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger() as never);

    let caught: PreflightError | undefined;
    try {
      await health.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }

    const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.error).toContain("Timed out after");
  });

  it("marks binary check failed when execute() itself throws", async () => {
    const execute = vi.fn().mockImplementation(({ args }: { args: string[] }) => {
      if (args.includes("--version")) return Promise.reject(new Error("spawn failed"));
      return Promise.resolve(makeResult());
    });
    const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger() as never);

    let caught: PreflightError | undefined;
    try {
      await health.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }

    const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.error).toBe("spawn failed");
  });

  describe("auth check variants", () => {
    it("fails the successPattern auth check when the pattern is not found in output", async () => {
      const execute = vi.fn().mockImplementation(({ command, args }: { command: string; args: string[] }) => {
        if (args.includes("--version")) return Promise.resolve(makeResult({ stdout: "1.0.0" }));
        if (command === "claude") return Promise.resolve(makeResult({ stdout: '{"loggedIn": false}' }));
        if (command === "codex") return Promise.resolve(makeResult({ stdout: "PONG" }));
        return Promise.resolve(makeResult());
      });
      const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger() as never);

      let caught: PreflightError | undefined;
      try {
        await health.runPreflight();
      } catch (err) {
        caught = err as PreflightError;
      }

      const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
      expect(claudeResult.authCheck.ok).toBe(false);
      expect(claudeResult.authCheck.error).toContain("expected pattern not found");
    });

    it("reports auth timeout distinctly", async () => {
      const execute = vi.fn().mockImplementation(({ command, args }: { command: string; args: string[] }) => {
        if (args.includes("--version")) return Promise.resolve(makeResult({ stdout: "1.0.0" }));
        if (command === "claude") return Promise.resolve(makeResult({ timedOut: true }));
        if (command === "codex") return Promise.resolve(makeResult({ stdout: "PONG" }));
        return Promise.resolve(makeResult());
      });
      const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger() as never);

      let caught: PreflightError | undefined;
      try {
        await health.runPreflight();
      } catch (err) {
        caught = err as PreflightError;
      }
      const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
      expect(claudeResult.authCheck.error).toContain("Auth probe timed out after");
    });

    it("passes the PONG-style auth check (no successPattern, no exitCodeOnly)", async () => {
      // codex has no successPattern/exitCodeOnly, so it falls through to the PONG check.
      const execute = vi.fn().mockImplementation(({ command, args }: { command: string; args: string[] }) => {
        if (args.includes("--version")) return Promise.resolve(makeResult({ stdout: "1.0.0" }));
        if (command === "claude") return Promise.resolve(makeResult({ stdout: '{"loggedIn": true}' }));
        if (command === "codex") return Promise.resolve(makeResult({ stdout: "pong" }));
        return Promise.resolve(makeResult());
      });
      const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger() as never);

      const result = await health.runPreflight();
      expect(result.ok).toBe(true);
    });

    it("fails the PONG-style auth check on a non-zero exit code with no PONG in output", async () => {
      const execute = vi.fn().mockImplementation(({ command, args }: { command: string; args: string[] }) => {
        if (args.includes("--version")) return Promise.resolve(makeResult({ stdout: "1.0.0" }));
        if (command === "claude") return Promise.resolve(makeResult({ stdout: '{"loggedIn": true}' }));
        if (command === "codex") return Promise.resolve(makeResult({ exitCode: 1, stderr: "boom" }));
        return Promise.resolve(makeResult());
      });
      const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger() as never);

      let caught: PreflightError | undefined;
      try {
        await health.runPreflight();
      } catch (err) {
        caught = err as PreflightError;
      }
      const codexResult = caught!.result.results.find((r) => r.runtime === "codex")!;
      expect(codexResult.authCheck.ok).toBe(false);
      expect(codexResult.authCheck.error).toContain("Exit code 1");
    });

    it("fails the PONG-style auth check on exit code 0 but no PONG text", async () => {
      const execute = vi.fn().mockImplementation(({ command, args }: { command: string; args: string[] }) => {
        if (args.includes("--version")) return Promise.resolve(makeResult({ stdout: "1.0.0" }));
        if (command === "claude") return Promise.resolve(makeResult({ stdout: '{"loggedIn": true}' }));
        if (command === "codex") return Promise.resolve(makeResult({ stdout: "something else" }));
        return Promise.resolve(makeResult());
      });
      const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger() as never);

      let caught: PreflightError | undefined;
      try {
        await health.runPreflight();
      } catch (err) {
        caught = err as PreflightError;
      }
      const codexResult = caught!.result.results.find((r) => r.runtime === "codex")!;
      expect(codexResult.authCheck.error).toContain("did not return expected response");
    });

    it("passes the exitCodeOnly auth check on exit code 0, regardless of output content", async () => {
      // cursor isn't a required runtime (no AGENT_STAGES entry uses it), so to exercise
      // its exitCodeOnly config we swap it into the "claude-code" slot, which is required.
      const execute = vi.fn().mockImplementation(({ args }: { args: string[] }) => {
        if (args.includes("--version")) return Promise.resolve(makeResult({ stdout: "1.0.0" }));
        if (args.includes("status")) return Promise.resolve(makeResult({ exitCode: 0 }));
        return Promise.resolve(makeResult({ stdout: "PONG" }));
      });
      const configs = makeConfigs();
      const health = new RuntimeHealthCheck(
        { execute } as never,
        { "claude-code": configs.cursor, codex: configs.codex, cursor: configs.cursor } as never,
        makeLogger() as never,
      );

      const result = await health.runPreflight();
      expect(result.ok).toBe(true);
    });

    it("fails the exitCodeOnly auth check on a non-zero exit code", async () => {
      const execute = vi.fn().mockImplementation(({ args }: { args: string[] }) => {
        if (args.includes("--version")) return Promise.resolve(makeResult({ stdout: "1.0.0" }));
        if (args.includes("status")) return Promise.resolve(makeResult({ exitCode: 2, stderr: "not logged in" }));
        return Promise.resolve(makeResult());
      });
      const configs = makeConfigs();
      const health = new RuntimeHealthCheck(
        { execute } as never,
        { "claude-code": configs.cursor, codex: configs.codex, cursor: configs.cursor } as never,
        makeLogger() as never,
      );

      let caught: PreflightError | undefined;
      try {
        await health.runPreflight();
      } catch (err) {
        caught = err as PreflightError;
      }
      const result = caught!.result.results.find((r) => r.runtime === "claude-code")!;
      expect(result.authCheck.error).toContain("Exit code 2");
    });

    it("reports a thrown error from the auth probe itself", async () => {
      const execute = vi.fn().mockImplementation(({ command, args }: { command: string; args: string[] }) => {
        if (args.includes("--version")) return Promise.resolve(makeResult({ stdout: "1.0.0" }));
        if (command === "claude") return Promise.reject(new Error("auth probe crashed"));
        if (command === "codex") return Promise.resolve(makeResult({ stdout: "PONG" }));
        return Promise.resolve(makeResult());
      });
      const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger() as never);

      let caught: PreflightError | undefined;
      try {
        await health.runPreflight();
      } catch (err) {
        caught = err as PreflightError;
      }
      const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
      expect(claudeResult.authCheck.error).toBe("auth probe crashed");
    });
  });
});
