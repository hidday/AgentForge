import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeProcessResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 10,
    timedOut: false,
    ...overrides,
  };
}

// Simple configs used across most direct-method tests below.
const successPatternConfig = {
  command: "claude",
  versionArgs: ["--version"],
  probeArgs: ["auth", "status"],
  successPattern: '"loggedIn":\\s*true',
};

const exitCodeOnlyConfig = {
  command: "cursor",
  versionArgs: ["--version"],
  probeArgs: ["status"],
  exitCodeOnly: true,
};

const pongConfig = {
  command: "codex",
  versionArgs: ["--version"],
  probeArgs: ["exec", "-"],
  probeStdin: "Respond with exactly: PONG",
};

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds the expected per-runtime probe configuration", () => {
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

describe("RuntimeHealthCheck.getRequiredRuntimes / getLastResult", () => {
  it("derives required runtimes from AGENT_STAGES and reports skipped runtimes", () => {
    const processRunner = { execute: vi.fn() };
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "cursor");
    const rhc = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const required = rhc.getRequiredRuntimes();
    // AGENT_STAGES only ever routes to claude-code and codex today.
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });

  it("returns undefined for getLastResult before any preflight has run", () => {
    const processRunner = { execute: vi.fn() };
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "cursor");
    const rhc = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    expect(rhc.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck — checkBinary (via direct invocation)", () => {
  function makeRhc(execute: ReturnType<typeof vi.fn>) {
    const processRunner = { execute };
    const logger = makeMockLogger();
    const rhc = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": successPatternConfig, codex: pongConfig, cursor: exitCodeOnlyConfig } as never,
      logger as never,
    );
    return { rhc, logger };
  }

  it("reports ok with the trimmed first line of stdout as version on success", async () => {
    const execute = vi.fn().mockResolvedValue(
      makeProcessResult({ stdout: "  claude-cli 1.2.3\nextra line\n" }),
    );
    const { rhc } = makeRhc(execute);

    const result = await (rhc as never as { checkBinary: (c: unknown) => Promise<unknown> }).checkBinary(
      successPatternConfig,
    );

    expect(result).toMatchObject({ ok: true, version: "claude-cli 1.2.3" });
  });

  it("reports not ok when the process times out", async () => {
    const execute = vi.fn().mockResolvedValue(makeProcessResult({ timedOut: true }));
    const { rhc } = makeRhc(execute);

    const result = (await (rhc as never as {
      checkBinary: (c: unknown) => Promise<{ ok: boolean; error?: string }>;
    }).checkBinary(successPatternConfig)) as { ok: boolean; error?: string };

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Timed out after");
  });

  it("reports not ok with a stderr snippet on non-zero exit", async () => {
    const execute = vi.fn().mockResolvedValue(
      makeProcessResult({ exitCode: 127, stderr: "command not found" }),
    );
    const { rhc } = makeRhc(execute);

    const result = (await (rhc as never as {
      checkBinary: (c: unknown) => Promise<{ ok: boolean; error?: string }>;
    }).checkBinary(successPatternConfig)) as { ok: boolean; error?: string };

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Exit code 127");
    expect(result.error).toContain("command not found");
  });

  it("reports not ok with the caught error's message when execute() rejects", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("spawn ENOENT"));
    const { rhc } = makeRhc(execute);

    const result = (await (rhc as never as {
      checkBinary: (c: unknown) => Promise<{ ok: boolean; error?: string }>;
    }).checkBinary(successPatternConfig)) as { ok: boolean; error?: string };

    expect(result.ok).toBe(false);
    expect(result.error).toBe("spawn ENOENT");
  });

  it("stringifies a non-Error rejection from execute()", async () => {
    const execute = vi.fn().mockRejectedValue("boom");
    const { rhc } = makeRhc(execute);

    const result = (await (rhc as never as {
      checkBinary: (c: unknown) => Promise<{ ok: boolean; error?: string }>;
    }).checkBinary(successPatternConfig)) as { ok: boolean; error?: string };

    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
  });
});

describe("RuntimeHealthCheck — checkAuth (via direct invocation)", () => {
  function makeRhc(execute: ReturnType<typeof vi.fn>) {
    const processRunner = { execute };
    const logger = makeMockLogger();
    const rhc = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": successPatternConfig, codex: pongConfig, cursor: exitCodeOnlyConfig } as never,
      logger as never,
    );
    const typed = rhc as never as {
      checkAuth: (c: unknown) => Promise<{ ok: boolean; error?: string; durationMs: number }>;
    };
    return (config: unknown) => typed.checkAuth(config);
  }

  it("reports not ok when the auth probe times out", async () => {
    const execute = vi.fn().mockResolvedValue(makeProcessResult({ timedOut: true }));
    const checkAuth = makeRhc(execute);

    const result = await checkAuth(successPatternConfig);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Auth probe timed out");
  });

  describe("successPattern branch", () => {
    it("passes when the pattern matches stdout", async () => {
      const execute = vi.fn().mockResolvedValue(
        makeProcessResult({ stdout: '{"loggedIn": true}' }),
      );
      const checkAuth = makeRhc(execute);

      const result = await checkAuth(successPatternConfig);
      expect(result.ok).toBe(true);
    });

    it("fails when the pattern does not match", async () => {
      const execute = vi.fn().mockResolvedValue(
        makeProcessResult({ stdout: '{"loggedIn": false}' }),
      );
      const checkAuth = makeRhc(execute);

      const result = await checkAuth(successPatternConfig);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("expected pattern not found");
    });

    it("matches against stderr too, since output combines stdout+stderr", async () => {
      const execute = vi.fn().mockResolvedValue(
        makeProcessResult({ stdout: "", stderr: '"loggedIn": true' }),
      );
      const checkAuth = makeRhc(execute);

      const result = await checkAuth(successPatternConfig);
      expect(result.ok).toBe(true);
    });
  });

  describe("exitCodeOnly branch", () => {
    it("passes on exit code 0 regardless of output", async () => {
      const execute = vi.fn().mockResolvedValue(makeProcessResult({ exitCode: 0 }));
      const checkAuth = makeRhc(execute);

      const result = await checkAuth(exitCodeOnlyConfig);
      expect(result.ok).toBe(true);
    });

    it("fails on non-zero exit code with a stderr/stdout snippet", async () => {
      const execute = vi.fn().mockResolvedValue(
        makeProcessResult({ exitCode: 1, stderr: "not logged in" }),
      );
      const checkAuth = makeRhc(execute);

      const result = await checkAuth(exitCodeOnlyConfig);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Exit code 1");
      expect(result.error).toContain("not logged in");
    });

    it("falls back to stdout in the error message when stderr is empty", async () => {
      const execute = vi.fn().mockResolvedValue(
        makeProcessResult({ exitCode: 2, stderr: "", stdout: "denied" }),
      );
      const checkAuth = makeRhc(execute);

      const result = await checkAuth(exitCodeOnlyConfig);
      expect(result.error).toContain("denied");
    });
  });

  describe("default (PONG) branch", () => {
    it("passes when the output contains PONG and exit code is 0", async () => {
      const execute = vi.fn().mockResolvedValue(makeProcessResult({ stdout: "PONG", exitCode: 0 }));
      const checkAuth = makeRhc(execute);

      const result = await checkAuth(pongConfig);
      expect(result.ok).toBe(true);
    });

    it("passes when PONG is present even if exit code is non-zero", async () => {
      const execute = vi.fn().mockResolvedValue(makeProcessResult({ stdout: "pong", exitCode: 1 }));
      const checkAuth = makeRhc(execute);

      const result = await checkAuth(pongConfig);
      expect(result.ok).toBe(true);
    });

    it("fails with an exit-code error when PONG is absent and exit code is non-zero", async () => {
      const execute = vi.fn().mockResolvedValue(
        makeProcessResult({ stdout: "", stderr: "auth required", exitCode: 1 }),
      );
      const checkAuth = makeRhc(execute);

      const result = await checkAuth(pongConfig);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Exit code 1");
    });

    it("fails with an unexpected-response error when PONG is absent but exit code is 0", async () => {
      const execute = vi.fn().mockResolvedValue(
        makeProcessResult({ stdout: "unexpected chatter", exitCode: 0 }),
      );
      const checkAuth = makeRhc(execute);

      const result = await checkAuth(pongConfig);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("did not return expected response");
    });
  });

  it("reports not ok with the caught error's message when execute() rejects", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("stdin write failed"));
    const checkAuth = makeRhc(execute);

    const result = await checkAuth(pongConfig);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("stdin write failed");
  });

  it("stringifies a non-Error rejection from execute()", async () => {
    const execute = vi.fn().mockRejectedValue(42);
    const checkAuth = makeRhc(execute);

    const result = await checkAuth(pongConfig);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("42");
  });
});

describe("RuntimeHealthCheck.runPreflight — integration", () => {
  const configs = {
    "claude-code": successPatternConfig,
    codex: pongConfig,
    cursor: exitCodeOnlyConfig,
  };

  it("resolves ok=true, sets lastResult, and logs success when every required runtime passes", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) {
        return makeProcessResult({ stdout: `${opts.command} v1.0.0` });
      }
      if (opts.command === "claude") {
        return makeProcessResult({ stdout: '{"loggedIn": true}' });
      }
      if (opts.command === "codex") {
        return makeProcessResult({ stdout: "PONG" });
      }
      return makeProcessResult({ exitCode: 0 });
    });
    const processRunner = { execute };
    const logger = makeMockLogger();
    const rhc = new RuntimeHealthCheck(processRunner as never, configs as never, logger as never);

    const result = await rhc.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(rhc.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("throws PreflightError, still sets lastResult, and logs the failing runtimes when binary check fails", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args.includes("--version")) {
        return makeProcessResult({ exitCode: 127, stderr: "not found" });
      }
      if (opts.args.includes("--version")) {
        return makeProcessResult({ stdout: `${opts.command} v1.0.0` });
      }
      if (opts.command === "codex") {
        return makeProcessResult({ stdout: "PONG" });
      }
      return makeProcessResult({ exitCode: 0 });
    });
    const processRunner = { execute };
    const logger = makeMockLogger();
    const rhc = new RuntimeHealthCheck(processRunner as never, configs as never, logger as never);

    await expect(rhc.runPreflight()).rejects.toBeInstanceOf(PreflightError);

    const lastResult = rhc.getLastResult();
    expect(lastResult?.ok).toBe(false);
    const claudeResult = lastResult?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    // Auth check is skipped entirely when the binary check already failed.
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("Skipped: binary check failed");

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ runtime: "claude-code" }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("fails when the binary check passes but the auth check fails", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) {
        return makeProcessResult({ stdout: `${opts.command} v1.0.0` });
      }
      if (opts.command === "claude") {
        return makeProcessResult({ stdout: '{"loggedIn": false}' });
      }
      return makeProcessResult({ stdout: "PONG" });
    });
    const processRunner = { execute };
    const logger = makeMockLogger();
    const rhc = new RuntimeHealthCheck(processRunner as never, configs as never, logger as never);

    const err = await rhc.runPreflight().catch((e) => e);
    expect(err).toBeInstanceOf(PreflightError);
    expect(err.result.ok).toBe(false);

    const claudeResult = (err.result.results as Array<{ runtime: string; binaryCheck: { ok: boolean }; authCheck: { ok: boolean } }>).find(
      (r) => r.runtime === "claude-code",
    );
    expect(claudeResult?.binaryCheck.ok).toBe(true);
    expect(claudeResult?.authCheck.ok).toBe(false);
  });
});
