import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeProcessRunner() {
  return { execute: vi.fn() };
}

function okResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 1, timedOut: false, ...overrides };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds a config per runtime with the expected probe shape", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--print"],
      "codex",
      ["exec", "-"],
      "agent",
    );
    expect(configs["claude-code"]).toMatchObject({ command: "claude", successPattern: '"loggedIn":\\s*true' });
    expect(configs.codex).toMatchObject({ command: "codex", probeArgs: ["exec", "-"], probeStdin: "Respond with exactly: PONG" });
    expect(configs.cursor).toMatchObject({ command: "agent", exitCodeOnly: true });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes", () => {
  it("derives the required runtime set from AGENT_STAGES (claude-code and codex only)", () => {
    const check = new RuntimeHealthCheck(
      makeProcessRunner() as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent"),
      makeMockLogger() as never,
    );
    const required = check.getRequiredRuntimes();
    expect(required).toEqual(new Set(["claude-code", "codex"]));
  });
});

describe("RuntimeHealthCheck.getLastResult", () => {
  it("is undefined before any preflight has run, and set afterwards", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent"),
      makeMockLogger() as never,
    );

    expect(check.getLastResult()).toBeUndefined();
    const result = await check.runPreflight();
    expect(check.getLastResult()).toBe(result);
  });
});

describe("RuntimeHealthCheck.runPreflight", () => {
  it("passes when every required runtime's binary and auth probes succeed", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[]; stdinData?: string }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0\n" });
      if (opts.args[0] === "auth") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ stdout: "PONG" });
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent"),
      logger as never,
    );

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    for (const r of result.results) {
      expect(r.binaryCheck.ok).toBe(true);
      expect(r.binaryCheck.version).toBe("1.0.0");
      expect(r.authCheck.ok).toBe(true);
    }
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("throws PreflightError and logs failures when a binary check fails", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        return okResult({ exitCode: 127, stderr: "command not found" });
      }
      if (opts.args[0] === "--version") return okResult({ stdout: "2.0.0\n" });
      return okResult({ stdout: '{"loggedIn": true}' });
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent"),
      logger as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ runtime: "claude-code", binaryError: expect.stringContaining("Exit code 127") }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );

    // The error carries the full preflight result for callers that need the detail.
    try {
      await check.runPreflight();
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightError);
      const preflightErr = err as PreflightError;
      expect(preflightErr.result.ok).toBe(false);
      expect(preflightErr.message).toContain("claude-code");
    }
  });

  it("skips the auth probe entirely when the binary check fails (authCheck marked as skipped)", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ exitCode: 1, stderr: "boom" });
      throw new Error("auth probe should never run when binary check fails");
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent"),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult();
    expect(result?.results.every((r) => r.authCheck.error === "Skipped: binary check failed")).toBe(true);
  });

  it("marks binary check failed when the probe throws", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args[0] === "--version") throw new Error("spawn ENOENT");
      return okResult({ stdout: '{"loggedIn": true}' });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent"),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult();
    const claude = result?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.binaryCheck.ok).toBe(false);
    expect(claude?.binaryCheck.error).toBe("spawn ENOENT");
  });

  it("marks binary check failed when the probe times out", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ timedOut: true });
      return okResult({ stdout: '{"loggedIn": true}' });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent"),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.binaryCheck.ok).toBe(false);
    expect(claude?.binaryCheck.error).toContain("Timed out");
  });

  it("fails auth when successPattern doesn't match the probe output", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": false}' });
      return okResult({ stdout: '{"loggedIn": true}' });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent"),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.authCheck.ok).toBe(false);
    expect(claude?.authCheck.error).toContain("expected pattern not found");
  });

  it("fails auth with exitCodeOnly when the exit code is non-zero", async () => {
    // cursor isn't a "required" runtime by default, so drive checkAuth indirectly
    // through codex's exitCodeOnly-equivalent path isn't available; use codex's
    // pong-based check with a non-zero exit and no PONG to hit the exit-code branch.
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      if (opts.command === "codex") return okResult({ exitCode: 1, stdout: "", stderr: "denied" });
      return okResult({ stdout: '{"loggedIn": true}' });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent"),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codex = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codex?.authCheck.ok).toBe(false);
    expect(codex?.authCheck.error).toContain("Exit code 1");
  });

  it("fails auth when exit code is 0 but PONG never appears in the output", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      if (opts.command === "codex") return okResult({ exitCode: 0, stdout: "unexpected chatter" });
      return okResult({ stdout: '{"loggedIn": true}' });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent"),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codex = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codex?.authCheck.ok).toBe(false);
    expect(codex?.authCheck.error).toContain("did not return expected response");
  });

  it("passes the pong-based auth check case-insensitively even with a non-zero exit code", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      if (opts.command === "codex") return okResult({ exitCode: 1, stdout: "noise Pong noise" });
      return okResult({ stdout: '{"loggedIn": true}' });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent"),
      makeMockLogger() as never,
    );

    const result = await check.runPreflight();
    const codex = result.results.find((r) => r.runtime === "codex");
    expect(codex?.authCheck.ok).toBe(true);
  });

  it("fails auth when the probe times out", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      return okResult({ timedOut: true });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent"),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.authCheck.error).toContain("Auth probe timed out");
  });

  it("marks auth check failed when the probe throws", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      if (opts.command === "claude") throw new Error("connection reset");
      return okResult({ stdout: '{"loggedIn": true}' });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent"),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.authCheck.ok).toBe(false);
    expect(claude?.authCheck.error).toBe("connection reset");
  });
});
