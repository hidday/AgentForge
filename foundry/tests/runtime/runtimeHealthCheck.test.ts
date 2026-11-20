import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function result(partial: Partial<ProcessResult>): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 1, timedOut: false, ...partial };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs()", () => {
  it("builds configs with the expected probe shapes for each runtime", () => {
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

describe("RuntimeHealthCheck.getRequiredRuntimes()", () => {
  it("returns the distinct set of runtimes used by AGENT_STAGES (claude-code and codex, not cursor)", () => {
    const processRunner = { execute: vi.fn() };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const health = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    const required = health.getRequiredRuntimes();
    expect(required).toEqual(new Set(["claude-code", "codex"]));
  });
});

describe("RuntimeHealthCheck.getLastResult()", () => {
  it("returns undefined before runPreflight() has ever run", () => {
    const processRunner = { execute: vi.fn() };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const health = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    expect(health.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight()", () => {
  let configs: ReturnType<typeof RuntimeHealthCheck.buildRuntimeConfigs>;

  beforeEach(() => {
    configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
  });

  it("resolves ok=true and caches the result when all required runtimes pass binary + auth checks", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") {
        return result({ stdout: "1.2.3\n", exitCode: 0 });
      }
      if (opts.command === "claude") {
        return result({ stdout: '{"loggedIn": true}', exitCode: 0 });
      }
      // codex probe: pong response
      return result({ stdout: "PONG", exitCode: 0 });
    });
    const processRunner = { execute };
    const logger = makeMockLogger();
    const health = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const preflight = await health.runPreflight();

    expect(preflight.ok).toBe(true);
    expect(preflight.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(preflight.skippedRuntimes).toEqual(["cursor"]);
    expect(preflight.results).toHaveLength(2);
    expect(health.getLastResult()).toBe(preflight);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("throws PreflightError and logs failures when a binary check fails (non-zero exit)", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        return result({ stdout: "", stderr: "command not found", exitCode: 127 });
      }
      if (opts.args[0] === "--version") {
        return result({ stdout: "codex 1.0\n", exitCode: 0 });
      }
      return result({ stdout: "PONG", exitCode: 0 });
    });
    const processRunner = { execute };
    const logger = makeMockLogger();
    const health = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ runtime: "claude-code", binaryError: expect.stringContaining("127") }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
    // Auth check should be skipped entirely when the binary check fails.
    const lastResult = health.getLastResult();
    const claudeResult = lastResult?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck).toMatchObject({ ok: false, error: "Skipped: binary check failed" });
  });

  it("marks binary check failed on timeout", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        return result({ timedOut: true });
      }
      if (opts.args[0] === "--version") return result({ stdout: "ok\n" });
      return result({ stdout: "PONG" });
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      configs,
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = health.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck).toMatchObject({ ok: false, error: expect.stringContaining("Timed out") });
  });

  it("marks binary check failed when processRunner.execute throws", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        throw new Error("spawn ENOENT");
      }
      if (opts.args[0] === "--version") return result({ stdout: "ok\n" });
      return result({ stdout: "PONG" });
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      configs,
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = health.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck).toMatchObject({ ok: false, error: "spawn ENOENT" });
  });

  it("fails auth check via timeout path", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return result({ stdout: "ok\n" });
      if (opts.command === "claude") return result({ timedOut: true });
      return result({ stdout: "PONG" });
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      configs,
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = health.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck).toMatchObject({ ok: false, error: expect.stringContaining("timed out") });
  });

  it("fails auth check via successPattern mismatch", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return result({ stdout: "ok\n" });
      if (opts.command === "claude") return result({ stdout: '{"loggedIn": false}' });
      return result({ stdout: "PONG" });
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      configs,
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = health.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck).toMatchObject({
      ok: false,
      error: expect.stringContaining("expected pattern not found"),
    });
  });

  it("fails auth check via exitCodeOnly path (used by cursor-shaped configs)", async () => {
    // Force the "required" set to include cursor by constructing configs
    // where cursor is probed directly via getRequiredRuntimes override is not
    // possible, so exercise checkAuth's exitCodeOnly branch through a
    // custom config object that reuses RuntimeHealthCheck's private logic
    // indirectly: we can't add cursor to AGENT_STAGES, so instead swap the
    // claude-code config for one with exitCodeOnly to hit that branch.
    const exitCodeOnlyConfigs = {
      ...configs,
      "claude-code": { ...configs["claude-code"], successPattern: undefined, exitCodeOnly: true },
    };
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return result({ stdout: "ok\n" });
      if (opts.command === "claude") return result({ stdout: "", stderr: "not authed", exitCode: 1 });
      return result({ stdout: "PONG" });
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      exitCodeOnlyConfigs,
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = health.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck).toMatchObject({
      ok: false,
      error: expect.stringContaining("Exit code 1"),
    });
  });

  it("passes auth check via exitCodeOnly path when exit code is 0", async () => {
    const exitCodeOnlyConfigs = {
      ...configs,
      "claude-code": { ...configs["claude-code"], successPattern: undefined, exitCodeOnly: true },
    };
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return result({ stdout: "ok\n" });
      if (opts.command === "claude") return result({ stdout: "", exitCode: 0 });
      return result({ stdout: "PONG" });
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      exitCodeOnlyConfigs,
      makeMockLogger() as never,
    );

    const preflight = await health.runPreflight();
    expect(preflight.ok).toBe(true);
  });

  it("fails auth check via the fallback pong-scan path when exit is non-zero and no pong found", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return result({ stdout: "ok\n" });
      if (opts.command === "claude") return result({ stdout: '{"loggedIn": true}' });
      // codex probe: non-zero exit, no PONG in output
      return result({ stdout: "", stderr: "auth failed", exitCode: 1 });
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      configs,
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const codexResult = health.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck).toMatchObject({
      ok: false,
      error: expect.stringContaining("Exit code 1"),
    });
  });

  it("fails auth check via the fallback pong-scan path when exit is zero but no pong found in output", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return result({ stdout: "ok\n" });
      if (opts.command === "claude") return result({ stdout: '{"loggedIn": true}' });
      return result({ stdout: "some unrelated chatter", exitCode: 0 });
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      configs,
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const codexResult = health.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck).toMatchObject({
      ok: false,
      error: expect.stringContaining("did not return expected response"),
    });
  });

  it("passes auth check via the fallback pong-scan path when pong is found despite non-zero exit", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return result({ stdout: "ok\n" });
      if (opts.command === "claude") return result({ stdout: '{"loggedIn": true}' });
      // non-zero exit but pong present in stderr -- still counts as ok
      return result({ stdout: "", stderr: "warning: pong received anyway", exitCode: 3 });
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      configs,
      makeMockLogger() as never,
    );

    const preflight = await health.runPreflight();
    expect(preflight.ok).toBe(true);
  });

  it("marks auth check failed when processRunner.execute throws", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return result({ stdout: "ok\n" });
      if (opts.command === "claude") throw new Error("boom auth");
      return result({ stdout: "PONG" });
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      configs,
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = health.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck).toMatchObject({ ok: false, error: "boom auth" });
  });

  it("stringifies a non-Error throw in the binary check catch branch", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "raw string failure";
      }
      if (opts.args[0] === "--version") return result({ stdout: "ok\n" });
      return result({ stdout: "PONG" });
    });
    const health = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = health.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck).toMatchObject({ ok: false, error: "raw string failure" });
  });

  it("stringifies a non-Error throw in the auth check catch branch", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return result({ stdout: "ok\n" });
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      if (opts.command === "claude") throw 42;
      return result({ stdout: "PONG" });
    });
    const health = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = health.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck).toMatchObject({ ok: false, error: "42" });
  });

  it("falls back to stdout in the exitCodeOnly error message when stderr is empty", async () => {
    const exitCodeOnlyConfigs = {
      ...configs,
      "claude-code": { ...configs["claude-code"], successPattern: undefined, exitCodeOnly: true },
    };
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return result({ stdout: "ok\n" });
      if (opts.command === "claude") {
        return result({ stdout: "stdout-only failure detail", stderr: "", exitCode: 1 });
      }
      return result({ stdout: "PONG" });
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      exitCodeOnlyConfigs,
      makeMockLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = health.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.error).toContain("stdout-only failure detail");
  });

  it("throws a PreflightError whose .result carries the full preflight summary", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        return result({ exitCode: 1, stderr: "nope" });
      }
      if (opts.args[0] === "--version") return result({ stdout: "ok\n" });
      return result({ stdout: "PONG" });
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      configs,
      makeMockLogger() as never,
    );

    try {
      await health.runPreflight();
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightError);
      expect((err as PreflightError).result.ok).toBe(false);
      expect((err as PreflightError).message).toContain("claude-code");
    }
  });
});
