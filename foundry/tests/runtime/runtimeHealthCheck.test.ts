import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeConfigs() {
  return RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor-agent");
}

function processResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 10,
    timedOut: false,
    ...overrides,
  };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs()", () => {
  it("builds the expected config shape for each runtime", () => {
    const configs = makeConfigs();

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
  it("returns the de-duplicated set of runtimes used by AGENT_STAGES", () => {
    const processRunner = { execute: vi.fn() };
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), makeMockLogger() as never);

    const required = check.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
  });
});

describe("RuntimeHealthCheck.getLastResult()", () => {
  it("returns undefined before any preflight has run", () => {
    const processRunner = { execute: vi.fn() };
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), makeMockLogger() as never);
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight() — success", () => {
  it("resolves ok:true when all required runtimes pass binary + auth checks, and caches the result", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") {
        return processResult({ stdout: "1.2.3\n" });
      }
      if (opts.command === "claude") {
        return processResult({ stdout: '{"loggedIn": true}' });
      }
      if (opts.command === "codex") {
        return processResult({ stdout: "PONG" });
      }
      return processResult({ exitCode: 0 });
    });
    const processRunner = { execute };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"].sort());
    expect(result.skippedRuntimes).toContain("cursor");
    expect(result.results).toHaveLength(2);
    for (const r of result.results) {
      expect(r.binaryCheck.ok).toBe(true);
      expect(r.binaryCheck.version).toBe("1.2.3");
      expect(r.authCheck.ok).toBe(true);
    }
    expect(check.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.anything(),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });
});

describe("RuntimeHealthCheck.runPreflight() — failure modes", () => {
  it("throws PreflightError (with the result attached) when a binary check fails", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        return processResult({ exitCode: 127, stderr: "command not found" });
      }
      if (opts.args[0] === "--version") {
        return processResult({ stdout: "1.0.0" });
      }
      if (opts.command === "codex") {
        return processResult({ stdout: "PONG" });
      }
      return processResult();
    });
    const processRunner = { execute };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    try {
      await check.runPreflight();
      expect.unreachable("expected runPreflight to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightError);
      const preflightErr = err as PreflightError;
      expect(preflightErr.result.ok).toBe(false);
      const claudeResult = preflightErr.result.results.find((r) => r.runtime === "claude-code")!;
      expect(claudeResult.binaryCheck.ok).toBe(false);
      expect(claudeResult.binaryCheck.error).toContain("Exit code 127");
      // Auth check should be skipped entirely when binary check fails.
      expect(claudeResult.authCheck.ok).toBe(false);
      expect(claudeResult.authCheck.error).toBe("Skipped: binary check failed");
    }

    expect(logger.error).toHaveBeenCalledWith(
      expect.anything(),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("marks binaryCheck as failed when the version check times out", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") {
        return processResult({ timedOut: true });
      }
      return processResult({ stdout: "PONG" });
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      makeConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    expect(result.results.every((r) => !r.binaryCheck.ok)).toBe(true);
    expect(result.results[0]!.binaryCheck.error).toContain("Timed out after");
  });

  it("marks binaryCheck as failed when execute() rejects", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") {
        throw new Error("spawn ENOENT");
      }
      return processResult({ stdout: "PONG" });
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      makeConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    expect(result.results.every((r) => r.binaryCheck.error === "spawn ENOENT")).toBe(true);
  });

  it("fails auth check via successPattern mismatch (claude-code not logged in)", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") {
        return processResult({ stdout: "1.0.0" });
      }
      if (opts.command === "claude") {
        return processResult({ stdout: '{"loggedIn": false}' });
      }
      return processResult({ stdout: "PONG" });
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      makeConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toContain("expected pattern not found");
  });

  it("fails auth check when the probe times out", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") {
        return processResult({ stdout: "1.0.0" });
      }
      return processResult({ timedOut: true });
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      makeConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    expect(result.results.every((r) => r.authCheck.error?.includes("Auth probe timed out"))).toBe(
      true,
    );
  });

  it("fails codex auth check (PONG-based) on non-zero exit without a pong", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") {
        return processResult({ stdout: "1.0.0" });
      }
      if (opts.command === "codex") {
        return processResult({ exitCode: 1, stdout: "", stderr: "model error" });
      }
      return processResult({ stdout: '{"loggedIn": true}' });
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      makeConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(false);
    expect(codexResult.authCheck.error).toContain("Exit code 1");
  });

  it("fails codex auth check (PONG-based) on exit code 0 but missing pong text", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") {
        return processResult({ stdout: "1.0.0" });
      }
      if (opts.command === "codex") {
        return processResult({ exitCode: 0, stdout: "nothing useful" });
      }
      return processResult({ stdout: '{"loggedIn": true}' });
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      makeConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(false);
    expect(codexResult.authCheck.error).toContain("did not return expected response");
  });

  it("passes codex auth check when a pong is found even with a non-zero exit code", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") {
        return processResult({ stdout: "1.0.0" });
      }
      if (opts.command === "codex") {
        return processResult({ exitCode: 1, stdout: "noisy PONG output" });
      }
      return processResult({ stdout: '{"loggedIn": true}' });
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      makeConfigs(),
      makeMockLogger() as never,
    );

    const result = await check.runPreflight();
    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(true);
  });

  it("exercises the exitCodeOnly auth branch directly (cursor is never required by AGENT_STAGES)", async () => {
    // cursor is not currently in any AGENT_STAGES entry, so runPreflight()
    // never probes it. Its exitCodeOnly auth logic is still real production
    // code (reached whenever cursor *is* configured as required), so we
    // reach it directly via the private checkAuth/checkBinary methods.
    const configs = makeConfigs();
    const logger = makeMockLogger();

    const failingExecute = vi.fn().mockResolvedValue(processResult({ exitCode: 3, stderr: "not logged in" }));
    const failingCheck = new RuntimeHealthCheck(
      { execute: failingExecute } as never,
      configs,
      logger as never,
    );
    const failingAuth = await (failingCheck as unknown as {
      checkAuth: (c: typeof configs.cursor) => Promise<{ ok: boolean; error?: string }>;
    }).checkAuth(configs.cursor);
    expect(failingAuth.ok).toBe(false);
    expect(failingAuth.error).toContain("Exit code 3");

    const passingExecute = vi.fn().mockResolvedValue(processResult({ exitCode: 0 }));
    const passingCheck = new RuntimeHealthCheck(
      { execute: passingExecute } as never,
      configs,
      logger as never,
    );
    const passingAuth = await (passingCheck as unknown as {
      checkAuth: (c: typeof configs.cursor) => Promise<{ ok: boolean }>;
    }).checkAuth(configs.cursor);
    expect(passingAuth.ok).toBe(true);
  });

  it("checkAuth rejects/handles a thrown error from execute()", async () => {
    const configs = makeConfigs();
    const execute = vi.fn().mockRejectedValue(new Error("network down"));
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const authResult = await (check as unknown as {
      checkAuth: (c: typeof configs.codex) => Promise<{ ok: boolean; error?: string }>;
    }).checkAuth(configs.codex);

    expect(authResult.ok).toBe(false);
    expect(authResult.error).toBe("network down");
  });

  it("checkBinary stringifies a non-Error value thrown by execute()", async () => {
    const configs = makeConfigs();
    const execute = vi.fn().mockRejectedValue("spawn failed: EACCES");
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const binaryResult = await (check as unknown as {
      checkBinary: (c: typeof configs.codex) => Promise<{ ok: boolean; error?: string }>;
    }).checkBinary(configs.codex);

    expect(binaryResult.ok).toBe(false);
    expect(binaryResult.error).toBe("spawn failed: EACCES");
  });

  it("checkAuth stringifies a non-Error value thrown by execute()", async () => {
    const configs = makeConfigs();
    const execute = vi.fn().mockRejectedValue("socket hang up");
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const authResult = await (check as unknown as {
      checkAuth: (c: typeof configs.codex) => Promise<{ ok: boolean; error?: string }>;
    }).checkAuth(configs.codex);

    expect(authResult.ok).toBe(false);
    expect(authResult.error).toBe("socket hang up");
  });

  it("exitCodeOnly auth failure falls back to stdout in the error message when stderr is empty", async () => {
    const configs = makeConfigs();
    const execute = vi
      .fn()
      .mockResolvedValue(processResult({ exitCode: 1, stderr: "", stdout: "denied: no session" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const authResult = await (check as unknown as {
      checkAuth: (c: typeof configs.cursor) => Promise<{ ok: boolean; error?: string }>;
    }).checkAuth(configs.cursor);

    expect(authResult.ok).toBe(false);
    expect(authResult.error).toContain("denied: no session");
  });
});
