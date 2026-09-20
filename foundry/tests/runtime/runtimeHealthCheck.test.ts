import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { AgentRuntime } from "../../src/domain/types.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function ok(stdout: string, extra: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout, stderr: "", exitCode: 0, durationMs: 5, timedOut: false, ...extra };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds per-runtime configs from the given commands", () => {
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

describe("RuntimeHealthCheck.getRequiredRuntimes", () => {
  it("returns exactly the runtimes referenced by AGENT_STAGES (claude-code and codex), never cursor", () => {
    const logger = makeMockLogger();
    const processRunner = { execute: vi.fn() };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "cursor");
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const required = check.getRequiredRuntimes();
    expect(required).toEqual(new Set<AgentRuntime>(["claude-code", "codex"]));
    expect(required.has("cursor")).toBe(false);
  });
});

describe("RuntimeHealthCheck.getLastResult", () => {
  it("returns undefined before runPreflight has ever run", () => {
    const logger = makeMockLogger();
    const processRunner = { execute: vi.fn() };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "cursor");
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight — aggregate success", () => {
  it("returns ok:true with skippedRuntimes:['cursor'] when every required runtime's binary and auth checks pass", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const processRunner = {
      execute: vi.fn(async (opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version") {
          return ok(`${opts.command} version 1.2.3`);
        }
        if (opts.command === "claude") {
          return ok('{"loggedIn": true}');
        }
        if (opts.command === "codex") {
          return ok("PONG");
        }
        return ok("");
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    for (const r of result.results) {
      expect(r.binaryCheck.ok).toBe(true);
      expect(r.binaryCheck.version).toContain("version 1.2.3");
      expect(r.authCheck.ok).toBe(true);
    }
    expect(typeof result.totalDurationMs).toBe("number");
    expect(check.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("truncates a multi-line version string to its first line, capped at 100 characters", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const longFirstLine = "v".repeat(150);
    const processRunner = {
      execute: vi.fn(async (opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version") {
          return ok(`${longFirstLine}\nsecond line ignored`);
        }
        return ok(opts.command === "claude" ? '{"loggedIn": true}' : "PONG");
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();

    for (const r of result.results) {
      expect(r.binaryCheck.version).toHaveLength(100);
      expect(r.binaryCheck.version).toBe(longFirstLine.slice(0, 100));
    }
  });
});

describe("RuntimeHealthCheck.runPreflight — binary check failures", () => {
  it("skips the auth check and fails preflight when a binary check returns a non-zero exit code", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const processRunner = {
      execute: vi.fn(async (opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version") {
          if (opts.command === "codex") {
            return { stdout: "", stderr: "command not found", exitCode: 127, durationMs: 3, timedOut: false };
          }
          return ok(`${opts.command} 1.0.0`);
        }
        return ok(opts.command === "claude" ? '{"loggedIn": true}' : "PONG");
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    // the failed result is still recorded for inspection
    const lastResult = check.getLastResult();
    expect(lastResult?.ok).toBe(false);
    const codexResult = lastResult?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.binaryCheck.ok).toBe(false);
    expect(codexResult?.binaryCheck.error).toContain("Exit code 127");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toBe("Skipped: binary check failed");

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ failures: expect.any(Array) }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("reports a timeout error when the binary check times out", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const processRunner = {
      execute: vi.fn(async (opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version" && opts.command === "claude") {
          return { stdout: "", stderr: "", exitCode: 0, durationMs: 5000, timedOut: true };
        }
        if (opts.args[0] === "--version") {
          return ok(`${opts.command} 1.0.0`);
        }
        return ok(opts.command === "claude" ? '{"loggedIn": true}' : "PONG");
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    let caught: unknown;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PreflightError);

    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toMatch(/Timed out after \d+ms/);
  });

  it("catches a rejected execute() call and reports it as a failed binary check", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const processRunner = {
      execute: vi.fn(async (opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version" && opts.command === "codex") {
          throw new Error("spawn codex ENOENT");
        }
        if (opts.args[0] === "--version") {
          return ok(`${opts.command} 1.0.0`);
        }
        return ok(opts.command === "claude" ? '{"loggedIn": true}' : "PONG");
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.binaryCheck.ok).toBe(false);
    expect(codexResult?.binaryCheck.error).toBe("spawn codex ENOENT");
  });
});

describe("RuntimeHealthCheck.runPreflight — auth check branches", () => {
  // These exercise every branch of checkAuth by attaching different config
  // "shapes" to the two runtimes that are actually required (claude-code,
  // codex). getRequiredRuntimes() is derived from AGENT_STAGES, which never
  // assigns any stage to "cursor" -- so cursor's exitCodeOnly config (as
  // built by buildRuntimeConfigs) can never be probed via the public API.
  // We instead attach an exitCodeOnly-shaped config to a required runtime
  // key so the exact same branch in checkAuth is still exercised.

  it("successPattern branch: fails auth when the pattern does not match the output", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const processRunner = {
      execute: vi.fn(async (opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version") return ok(`${opts.command} 1.0.0`);
        if (opts.command === "claude") return ok('{"loggedIn": false}');
        return ok("PONG");
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("expected pattern not found in output");
  });

  it("successPattern branch: passes when the pattern matches stderr too (stdout+stderr concatenated)", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const processRunner = {
      execute: vi.fn(async (opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version") return ok(`${opts.command} 1.0.0`);
        if (opts.command === "claude") {
          return { stdout: "", stderr: '{"loggedIn": true}', exitCode: 0, durationMs: 1, timedOut: false };
        }
        return ok("PONG");
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();
    const claudeResult = result.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(true);
  });

  it("exitCodeOnly branch: passes on exit code 0 regardless of output content", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    configs.codex.successPattern = undefined;
    configs.codex.exitCodeOnly = true;
    const processRunner = {
      execute: vi.fn(async (opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version") return ok(`${opts.command} 1.0.0`);
        if (opts.command === "claude") return ok('{"loggedIn": true}');
        return ok("this is not a recognizable pong response");
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();
    const codexResult = result.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(true);
  });

  it("exitCodeOnly branch: fails with the exit code and stderr/stdout tail when exit code is non-zero", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    configs.codex.successPattern = undefined;
    configs.codex.exitCodeOnly = true;
    const processRunner = {
      execute: vi.fn(async (opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version") return ok(`${opts.command} 1.0.0`);
        if (opts.command === "claude") return ok('{"loggedIn": true}');
        return { stdout: "", stderr: "not authenticated", exitCode: 1, durationMs: 1, timedOut: false };
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("Exit code 1");
    expect(codexResult?.authCheck.error).toContain("not authenticated");
  });

  it("default (PONG) branch: passes when output contains 'pong' case-insensitively and exit code is 0", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const processRunner = {
      execute: vi.fn(async (opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version") return ok(`${opts.command} 1.0.0`);
        if (opts.command === "claude") return ok('{"loggedIn": true}');
        return ok("PoNg");
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();
    expect(result.results.find((r) => r.runtime === "codex")?.authCheck.ok).toBe(true);
  });

  it("default (PONG) branch: passes when exit code is non-zero but the response still contains PONG", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const processRunner = {
      execute: vi.fn(async (opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version") return ok(`${opts.command} 1.0.0`);
        if (opts.command === "claude") return ok('{"loggedIn": true}');
        return { stdout: "PONG", stderr: "", exitCode: 1, durationMs: 1, timedOut: false };
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();
    expect(result.results.find((r) => r.runtime === "codex")?.authCheck.ok).toBe(true);
  });

  it("default (PONG) branch: fails with exit-code error when exit code is non-zero and no PONG present", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const processRunner = {
      execute: vi.fn(async (opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version") return ok(`${opts.command} 1.0.0`);
        if (opts.command === "claude") return ok('{"loggedIn": true}');
        return { stdout: "", stderr: "connection refused", exitCode: 1, durationMs: 1, timedOut: false };
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.error).toContain("Exit code 1");
    expect(codexResult?.authCheck.error).toContain("connection refused");
  });

  it("default (PONG) branch: fails with 'did not return expected response' when exit code is 0 but no PONG present", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const processRunner = {
      execute: vi.fn(async (opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version") return ok(`${opts.command} 1.0.0`);
        if (opts.command === "claude") return ok('{"loggedIn": true}');
        return ok("some unrelated chatter");
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.error).toContain("did not return expected response");
  });

  it("reports a timeout error when the auth probe times out", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const processRunner = {
      execute: vi.fn(async (opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version") return ok(`${opts.command} 1.0.0`);
        if (opts.command === "claude") {
          return { stdout: "", stderr: "", exitCode: 0, durationMs: 30000, timedOut: true };
        }
        return ok("PONG");
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.error).toMatch(/Auth probe timed out after \d+ms/);
  });

  it("catches a rejected execute() call during the auth probe and reports it as a failed auth check", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const processRunner = {
      execute: vi.fn(async (opts: { command: string; args: string[] }) => {
        if (opts.args[0] === "--version") return ok(`${opts.command} 1.0.0`);
        if (opts.command === "claude") throw new Error("auth probe crashed");
        return ok("PONG");
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toBe("auth probe crashed");
  });
});
