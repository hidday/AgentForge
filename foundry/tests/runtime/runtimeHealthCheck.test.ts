import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult, ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function ok(stdout = "", stderr = "", exitCode = 0): ProcessResult {
  return { stdout, stderr, exitCode, durationMs: 10, timedOut: false };
}

function timedOut(): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 1, durationMs: 5000, timedOut: true };
}

const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");

describe("RuntimeHealthCheck.buildRuntimeConfigs()", () => {
  it("builds command/probe configuration for each runtime", () => {
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
      command: "agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes() / getLastResult()", () => {
  it("derives required runtimes from AGENT_STAGES (claude-code and codex, never cursor)", () => {
    const check = new RuntimeHealthCheck({ execute: vi.fn() } as never, configs, makeLogger() as never);
    expect(check.getRequiredRuntimes()).toEqual(new Set(["claude-code", "codex"]));
  });

  it("getLastResult() is undefined before runPreflight() has ever run", () => {
    const check = new RuntimeHealthCheck({ execute: vi.fn() } as never, configs, makeLogger() as never);
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight() — healthy path", () => {
  it("resolves ok:true when all required runtimes pass binary and auth checks", async () => {
    const execute = vi.fn((opts: ProcessSpawnOptions) => {
      if (opts.command === "claude" && opts.args[0] === "--version") return Promise.resolve(ok("1.2.3\n"));
      if (opts.command === "claude" && opts.args[0] === "auth") return Promise.resolve(ok('{"loggedIn": true}'));
      if (opts.command === "codex" && opts.args[0] === "--version") return Promise.resolve(ok("codex 4.5\n"));
      if (opts.command === "codex" && opts.args[0] === "exec") return Promise.resolve(ok("PONG"));
      return Promise.reject(new Error(`unexpected call: ${opts.command} ${opts.args.join(" ")}`));
    });
    const processRunner = { execute };
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect([...result.requiredRuntimes].sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    for (const r of result.results) {
      expect(r.binaryCheck.ok).toBe(true);
      expect(r.authCheck.ok).toBe(true);
    }
    expect(check.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("passes the codex auth check on a PONG response even with a non-zero exit code", async () => {
    const execute = vi.fn((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") return Promise.resolve(ok("v1\n"));
      if (opts.command === "claude" && opts.args[0] === "auth") return Promise.resolve(ok('{"loggedIn": true}'));
      if (opts.command === "codex" && opts.args[0] === "exec") return Promise.resolve(ok("noise PONG noise", "", 1));
      return Promise.reject(new Error("unexpected"));
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);

    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });
});

describe("RuntimeHealthCheck.runPreflight() — unhealthy paths", () => {
  it("throws PreflightError and skips the auth check when the binary check fails", async () => {
    const execute = vi.fn((opts: ProcessSpawnOptions) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        return Promise.resolve(ok("", "command not found", 127));
      }
      if (opts.command === "codex" && opts.args[0] === "--version") return Promise.resolve(ok("codex 4.5\n"));
      if (opts.command === "codex" && opts.args[0] === "exec") return Promise.resolve(ok("PONG"));
      return Promise.reject(new Error("unexpected"));
    });
    const logger = makeLogger();
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const lastResult = check.getLastResult();
    expect(lastResult?.ok).toBe(false);
    const claudeResult = lastResult?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toContain("Exit code 127");
    expect(claudeResult?.authCheck).toEqual({
      ok: false,
      durationMs: 0,
      error: "Skipped: binary check failed",
    });
    expect(logger.error).toHaveBeenCalled();
  });

  it("marks the binary check as failed when the version probe times out", async () => {
    const execute = vi.fn((opts: ProcessSpawnOptions) => {
      if (opts.command === "claude" && opts.args[0] === "--version") return Promise.resolve(timedOut());
      if (opts.command === "codex" && opts.args[0] === "--version") return Promise.resolve(ok("codex 4.5\n"));
      if (opts.command === "codex" && opts.args[0] === "exec") return Promise.resolve(ok("PONG"));
      return Promise.reject(new Error("unexpected"));
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toBe("Timed out after 5000ms");
  });

  it("marks the auth check as failed when the auth probe times out", async () => {
    const execute = vi.fn((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") return Promise.resolve(ok("v1\n"));
      if (opts.command === "claude" && opts.args[0] === "auth") return Promise.resolve(timedOut());
      if (opts.command === "codex" && opts.args[0] === "exec") return Promise.resolve(ok("PONG"));
      return Promise.reject(new Error("unexpected"));
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toBe("Auth probe timed out after 30000ms");
  });

  it("fails the claude-code auth check when the success pattern does not match", async () => {
    const execute = vi.fn((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") return Promise.resolve(ok("v1\n"));
      if (opts.command === "claude" && opts.args[0] === "auth") return Promise.resolve(ok('{"loggedIn": false}'));
      if (opts.command === "codex" && opts.args[0] === "exec") return Promise.resolve(ok("PONG"));
      return Promise.reject(new Error("unexpected"));
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("expected pattern not found");
  });

  it("fails the codex auth check when neither exit code nor PONG indicate success", async () => {
    const execute = vi.fn((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") return Promise.resolve(ok("v1\n"));
      if (opts.command === "claude" && opts.args[0] === "auth") return Promise.resolve(ok('{"loggedIn": true}'));
      if (opts.command === "codex" && opts.args[0] === "exec") {
        return Promise.resolve(ok("", "not authenticated", 1));
      }
      return Promise.reject(new Error("unexpected"));
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("Exit code 1");
  });

  it("fails the codex auth check when exit code is 0 but no PONG is found in output", async () => {
    const execute = vi.fn((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") return Promise.resolve(ok("v1\n"));
      if (opts.command === "claude" && opts.args[0] === "auth") return Promise.resolve(ok('{"loggedIn": true}'));
      if (opts.command === "codex" && opts.args[0] === "exec") return Promise.resolve(ok("nothing useful", "", 0));
      return Promise.reject(new Error("unexpected"));
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("did not return expected response");
  });

  it("catches a rejected processRunner.execute() during the binary check and reports the error message", async () => {
    const failure = new Error("spawn ENOENT");
    const execute = vi.fn((opts: ProcessSpawnOptions) => {
      if (opts.command === "claude" && opts.args[0] === "--version") return Promise.reject(failure);
      if (opts.command === "codex" && opts.args[0] === "--version") return Promise.resolve(ok("codex 4.5\n"));
      if (opts.command === "codex" && opts.args[0] === "exec") return Promise.resolve(ok("PONG"));
      return Promise.reject(new Error("unexpected"));
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toBe("spawn ENOENT");
  });

  it("catches a non-Error rejection during the binary check and stringifies it", async () => {
    const execute = vi.fn((opts: ProcessSpawnOptions) => {
      if (opts.command === "claude" && opts.args[0] === "--version") return Promise.reject("raw string failure");
      if (opts.command === "codex" && opts.args[0] === "--version") return Promise.resolve(ok("codex 4.5\n"));
      if (opts.command === "codex" && opts.args[0] === "exec") return Promise.resolve(ok("PONG"));
      return Promise.reject(new Error("unexpected"));
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.error).toBe("raw string failure");
  });

  it("catches a rejected processRunner.execute() during the auth check and reports the error message", async () => {
    const failure = new Error("stdin write failed");
    const execute = vi.fn((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") return Promise.resolve(ok("v1\n"));
      if (opts.command === "claude" && opts.args[0] === "auth") return Promise.reject(failure);
      if (opts.command === "codex" && opts.args[0] === "exec") return Promise.resolve(ok("PONG"));
      return Promise.reject(new Error("unexpected"));
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toBe("stdin write failed");
  });
});

describe("RuntimeHealthCheck — exitCodeOnly auth-check branch (cursor)", () => {
  // AGENT_STAGES never routes to "cursor" as a required runtime, so runPreflight()
  // never reaches this branch. Exercise it directly against the cursor config,
  // the same way probeRuntime() would if cursor were ever required.
  it("fails on a non-zero exit code", async () => {
    const check = new RuntimeHealthCheck(
      { execute: vi.fn().mockResolvedValue(ok("", "cursor not logged in", 1)) } as never,
      configs,
      makeLogger() as never,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reaching a private method on purpose
    const authResult = await (check as any).checkAuth(configs.cursor);
    expect(authResult).toEqual({
      ok: false,
      durationMs: expect.any(Number),
      error: "Exit code 1: cursor not logged in",
    });
  });

  it("passes on exit code 0 without needing a pattern match", async () => {
    const check = new RuntimeHealthCheck(
      { execute: vi.fn().mockResolvedValue(ok("ready")) } as never,
      configs,
      makeLogger() as never,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reaching a private method on purpose
    const authResult = await (check as any).checkAuth(configs.cursor);
    expect(authResult).toEqual({ ok: true, durationMs: expect.any(Number) });
  });
});
