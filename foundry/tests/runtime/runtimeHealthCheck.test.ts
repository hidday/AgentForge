import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

function makeResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 5,
    timedOut: false,
    ...overrides,
  };
}

function makeConfigs() {
  return RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
}

describe("RuntimeHealthCheck.buildRuntimeConfigs()", () => {
  it("builds a config for each runtime with the expected command/probe shape", () => {
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
      command: "agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes() / getLastResult()", () => {
  it("derives required runtimes from AGENT_STAGES (claude-code and codex are used; cursor is not)", () => {
    const processRunner = { execute: vi.fn() };
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), makeMockLogger() as never);

    const required = check.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });

  it("returns undefined before any preflight has run", () => {
    const processRunner = { execute: vi.fn() };
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), makeMockLogger() as never);
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight() — success path", () => {
  it("resolves ok:true, records skippedRuntimes, and caches the result for getLastResult()", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation(async ({ command, args }: { command: string; args: string[] }) => {
        if (args[0] === "--version") {
          return makeResult({ stdout: `${command} v1.2.3\n`, exitCode: 0 });
        }
        if (command === "claude") {
          return makeResult({ stdout: '{"loggedIn": true}', exitCode: 0 });
        }
        if (command === "codex") {
          return makeResult({ stdout: "PONG", exitCode: 0 });
        }
        return makeResult({ exitCode: 0 });
      }),
    };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(typeof result.totalDurationMs).toBe("number");
    expect(check.getLastResult()).toBe(result);

    // binary + auth check for each of the 2 required runtimes.
    expect(processRunner.execute).toHaveBeenCalledTimes(4);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("captures the version string from the first line of stdout, truncated to 100 chars", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation(async ({ command, args }: { command: string; args: string[] }) => {
        if (args[0] === "--version") {
          return makeResult({ stdout: `v9.9.9 (build info)\nextra line\n`, exitCode: 0 });
        }
        if (command === "claude") return makeResult({ stdout: '{"loggedIn": true}', exitCode: 0 });
        return makeResult({ stdout: "PONG", exitCode: 0 });
      }),
    };
    const logger = makeMockLogger();
    const configs = makeConfigs();
    // Narrow to a single required runtime by only using claude-code's config;
    // but getRequiredRuntimes always includes both claude-code and codex, so
    // just inspect whichever binaryCheck we like from the full result.
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.ok).toBe(true);
    expect(claudeResult.binaryCheck.version).toBe("v9.9.9 (build info)");
  });
});

describe("RuntimeHealthCheck.runPreflight() — failure paths", () => {
  it("throws PreflightError and logs failures when a binary check fails (non-zero exit)", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation(async ({ command, args }: { command: string; args: string[] }) => {
        if (command === "claude" && args[0] === "--version") {
          return makeResult({ exitCode: 127, stderr: "command not found" });
        }
        if (args[0] === "--version") {
          return makeResult({ stdout: "v1.0.0", exitCode: 0 });
        }
        return makeResult({ stdout: "PONG", exitCode: 0 });
      }),
    };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const lastResult = check.getLastResult();
    expect(lastResult?.ok).toBe(false);
    const claudeResult = lastResult?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toContain("Exit code 127");
    // Auth check is skipped entirely when the binary check fails.
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toBe("Skipped: binary check failed");
    expect(claudeResult?.authCheck.durationMs).toBe(0);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ runtime: "claude-code", binaryError: expect.stringContaining("127") }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("carries the failing PreflightResult on the thrown PreflightError", async () => {
    const processRunner = {
      execute: vi.fn().mockResolvedValue(makeResult({ exitCode: 1, stderr: "nope" })),
    };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    try {
      await check.runPreflight();
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightError);
      const e = err as PreflightError;
      expect(e.result.ok).toBe(false);
      expect(e.message).toContain("Preflight failed for runtimes:");
    }
  });

  it("fails the auth check when the binary check passes but auth does not (successPattern mismatch)", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation(async ({ command, args }: { command: string; args: string[] }) => {
        if (args[0] === "--version") return makeResult({ stdout: "v1", exitCode: 0 });
        if (command === "claude") return makeResult({ stdout: '{"loggedIn": false}', exitCode: 0 });
        return makeResult({ stdout: "PONG", exitCode: 0 });
      }),
    };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(true);
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("expected pattern not found");
  });
});

describe("RuntimeHealthCheck — checkBinary() branches (via runPreflight)", () => {
  it("marks binaryCheck failed when the process times out", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation(async ({ args }: { args: string[] }) => {
        if (args[0] === "--version") {
          return makeResult({ timedOut: true });
        }
        return makeResult({ stdout: "PONG", exitCode: 0 });
      }),
    };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const results = check.getLastResult()?.results ?? [];
    for (const r of results) {
      expect(r.binaryCheck.ok).toBe(false);
      expect(r.binaryCheck.error).toContain("Timed out after");
    }
  });

  it("marks binaryCheck failed when processRunner.execute rejects", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation(async ({ args }: { args: string[] }) => {
        if (args[0] === "--version") {
          throw new Error("spawn ENOENT");
        }
        return makeResult({ stdout: "PONG", exitCode: 0 });
      }),
    };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const results = check.getLastResult()?.results ?? [];
    for (const r of results) {
      expect(r.binaryCheck.ok).toBe(false);
      expect(r.binaryCheck.error).toBe("spawn ENOENT");
    }
  });
});

describe("RuntimeHealthCheck — checkAuth() branches", () => {
  // Use a minimal single-runtime config set to isolate auth-check behavior;
  // getRequiredRuntimes() always requires claude-code+codex so we drive both
  // through custom configs and read out the one under test.
  function configsFor(overrides: Partial<ReturnType<typeof makeConfigs>["codex"]>) {
    const base = makeConfigs();
    return { ...base, codex: { ...base.codex, ...overrides } };
  }

  it("auth passes on exitCodeOnly config when exitCode is 0 (cursor-style), independent of output", async () => {
    // cursor isn't required, so drive this via a required runtime configured
    // with exitCodeOnly to exercise that branch directly.
    const configs = configsFor({ exitCodeOnly: true, successPattern: undefined, probeStdin: undefined });
    const processRunner = {
      execute: vi.fn().mockImplementation(async ({ command, args }: { command: string; args: string[] }) => {
        if (args[0] === "--version") return makeResult({ stdout: "v1", exitCode: 0 });
        if (command === "claude") return makeResult({ stdout: '{"loggedIn": true}', exitCode: 0 });
        return makeResult({ stdout: "irrelevant text", exitCode: 0 });
      }),
    };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
    const codexResult = result.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(true);
  });

  it("auth fails on exitCodeOnly config when exitCode is non-zero", async () => {
    const configs = configsFor({ exitCodeOnly: true, successPattern: undefined, probeStdin: undefined });
    const processRunner = {
      execute: vi.fn().mockImplementation(async ({ command, args }: { command: string; args: string[] }) => {
        if (args[0] === "--version") return makeResult({ stdout: "v1", exitCode: 0 });
        if (command === "claude") return makeResult({ stdout: '{"loggedIn": true}', exitCode: 0 });
        return makeResult({ stdout: "", stderr: "unauthorized", exitCode: 1 });
      }),
    };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("Exit code 1");
    expect(codexResult?.authCheck.error).toContain("unauthorized");
  });

  it("auth check times out (PROBE_TIMEOUT_MS path)", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation(async ({ args }: { args: string[] }) => {
        if (args[0] === "--version") return makeResult({ stdout: "v1", exitCode: 0 });
        return makeResult({ timedOut: true });
      }),
    };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const results = check.getLastResult()?.results ?? [];
    for (const r of results) {
      expect(r.authCheck.ok).toBe(false);
      expect(r.authCheck.error).toContain("Auth probe timed out after");
    }
  });

  it("auth check catches a rejected processRunner.execute", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation(async ({ args }: { args: string[] }) => {
        if (args[0] === "--version") return makeResult({ stdout: "v1", exitCode: 0 });
        throw new Error("stdin write failed");
      }),
    };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const results = check.getLastResult()?.results ?? [];
    for (const r of results) {
      expect(r.authCheck.ok).toBe(false);
      expect(r.authCheck.error).toBe("stdin write failed");
    }
  });

  it("default (PONG) path: passes when exitCode is 0 and output contains 'pong' (case-insensitive)", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation(async ({ command, args }: { command: string; args: string[] }) => {
        if (args[0] === "--version") return makeResult({ stdout: "v1", exitCode: 0 });
        if (command === "claude") return makeResult({ stdout: '{"loggedIn": true}', exitCode: 0 });
        return makeResult({ stdout: "pong!", exitCode: 0 });
      }),
    };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });

  it("default (PONG) path: a non-zero exit is still treated as failure even when pong text is absent", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation(async ({ command, args }: { command: string; args: string[] }) => {
        if (args[0] === "--version") return makeResult({ stdout: "v1", exitCode: 0 });
        if (command === "claude") return makeResult({ stdout: '{"loggedIn": true}', exitCode: 0 });
        return makeResult({ stdout: "", stderr: "auth expired", exitCode: 1 });
      }),
    };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("Exit code 1");
    expect(codexResult?.authCheck.error).toContain("auth expired");
  });

  it("default (PONG) path: exitCode 0 with no pong text in output fails with the 'did not return expected response' message", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation(async ({ command, args }: { command: string; args: string[] }) => {
        if (args[0] === "--version") return makeResult({ stdout: "v1", exitCode: 0 });
        if (command === "claude") return makeResult({ stdout: '{"loggedIn": true}', exitCode: 0 });
        return makeResult({ stdout: "something else entirely", exitCode: 0 });
      }),
    };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("did not return expected response");
  });

  it("documents current behavior: a non-zero exit code with pong text present still counts as auth success", async () => {
    // NOTE: this looks like it may be an unintended leniency in the default
    // (PONG) auth-check branch — `hasPong` alone can override a non-zero
    // exit code. Asserting the CURRENT behavior rather than assumed-correct
    // behavior, per instructions not to "fix" source in this pass.
    const processRunner = {
      execute: vi.fn().mockImplementation(async ({ command, args }: { command: string; args: string[] }) => {
        if (args[0] === "--version") return makeResult({ stdout: "v1", exitCode: 0 });
        if (command === "claude") return makeResult({ stdout: '{"loggedIn": true}', exitCode: 0 });
        return makeResult({ stdout: "PONG", exitCode: 1, stderr: "warning noise" });
      }),
    };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    const result = await check.runPreflight();
    const codexResult = result.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(true);
  });

  it("passes stdinData through to the auth probe when probeStdin is configured", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation(async ({ command, args }: { command: string; args: string[] }) => {
        if (args[0] === "--version") return makeResult({ stdout: "v1", exitCode: 0 });
        if (command === "claude") return makeResult({ stdout: '{"loggedIn": true}', exitCode: 0 });
        return makeResult({ stdout: "PONG", exitCode: 0 });
      }),
    };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    await check.runPreflight();

    const codexAuthCall = processRunner.execute.mock.calls.find(
      ([opts]: [{ command: string; args: string[] }]) => opts.command === "codex" && opts.args[0] === "exec",
    );
    expect(codexAuthCall?.[0].stdinData).toBe("Respond with exactly: PONG");
  });
});
