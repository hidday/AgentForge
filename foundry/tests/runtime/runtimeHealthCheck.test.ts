import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const CLAUDE_CMD = "claude-bin";
const CODEX_CMD = "codex-bin";
const CURSOR_CMD = "cursor-bin";

function okResult(stdout: string, extra: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout, stderr: "", exitCode: 0, durationMs: 5, timedOut: false, ...extra };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds configs for all three runtimes with the expected probe shapes", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      CLAUDE_CMD,
      [],
      CODEX_CMD,
      ["exec", "-"],
      CURSOR_CMD,
    );

    expect(configs["claude-code"]).toMatchObject({
      command: CLAUDE_CMD,
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });
    expect(configs.codex).toMatchObject({
      command: CODEX_CMD,
      versionArgs: ["--version"],
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });
    expect(configs.cursor).toMatchObject({
      command: CURSOR_CMD,
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes / getLastResult", () => {
  it("required runtimes are derived from AGENT_STAGES (claude-code and codex; cursor is unused)", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      CLAUDE_CMD,
      [],
      CODEX_CMD,
      ["exec", "-"],
      CURSOR_CMD,
    );
    const check = new RuntimeHealthCheck(
      { execute: vi.fn() } as never,
      configs,
      makeMockLogger() as never,
    );

    const required = check.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });

  it("getLastResult returns undefined before any preflight has run", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      CLAUDE_CMD,
      [],
      CODEX_CMD,
      ["exec", "-"],
      CURSOR_CMD,
    );
    const check = new RuntimeHealthCheck(
      { execute: vi.fn() } as never,
      configs,
      makeMockLogger() as never,
    );

    expect(check.getLastResult()).toBeUndefined();
  });
});

/**
 * Builds a ProcessRunner.execute mock that branches on command + args so the
 * two required runtimes (claude-code, codex) can be probed concurrently
 * without depending on call ordering between them.
 */
function buildExecuteMock(handlers: {
  claudeBinary?: () => Promise<ProcessResult> | ProcessResult;
  claudeAuth?: () => Promise<ProcessResult> | ProcessResult;
  codexBinary?: () => Promise<ProcessResult> | ProcessResult;
  codexAuth?: () => Promise<ProcessResult> | ProcessResult;
}) {
  return vi.fn(async (opts: { command: string; args: string[] }) => {
    if (opts.command === CLAUDE_CMD && opts.args[0] === "--version") {
      return handlers.claudeBinary
        ? handlers.claudeBinary()
        : okResult("claude v1.0.0\n");
    }
    if (opts.command === CLAUDE_CMD && opts.args[0] === "auth") {
      return handlers.claudeAuth
        ? handlers.claudeAuth()
        : okResult('{"loggedIn": true}');
    }
    if (opts.command === CODEX_CMD && opts.args[0] === "--version") {
      return handlers.codexBinary ? handlers.codexBinary() : okResult("codex v2.0.0\n");
    }
    if (opts.command === CODEX_CMD) {
      return handlers.codexAuth ? handlers.codexAuth() : okResult("", { stdout: "PONG" });
    }
    throw new Error(`Unexpected execute() call: ${JSON.stringify(opts)}`);
  });
}

function buildCheck(execute: ReturnType<typeof buildExecuteMock>, logger = makeMockLogger()) {
  const configs = RuntimeHealthCheck.buildRuntimeConfigs(
    CLAUDE_CMD,
    [],
    CODEX_CMD,
    ["exec", "-"],
    CURSOR_CMD,
  );
  return {
    check: new RuntimeHealthCheck({ execute } as never, configs, logger as never),
    logger,
  };
}

describe("RuntimeHealthCheck.runPreflight — success path", () => {
  it("returns ok:true, records requiredRuntimes/skippedRuntimes, and caches the result", async () => {
    const execute = buildExecuteMock({});
    const { check, logger } = buildCheck(execute);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(typeof result.totalDurationMs).toBe("number");
    expect(check.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.anything(),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );

    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.ok).toBe(true);
    expect(claudeResult.binaryCheck.version).toBe("claude v1.0.0");
    expect(claudeResult.authCheck.ok).toBe(true);

    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.binaryCheck.ok).toBe(true);
    expect(codexResult.authCheck.ok).toBe(true);
  });
});

describe("RuntimeHealthCheck.runPreflight — failure paths", () => {
  it("throws PreflightError and logs an error when a binary check fails, skipping the auth probe", async () => {
    const execute = buildExecuteMock({
      claudeBinary: () => okResult("", { exitCode: 127, stderr: "command not found" }),
    });
    const { check, logger } = buildCheck(execute);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    expect(logger.error).toHaveBeenCalledWith(
      expect.anything(),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );

    const result = check.getLastResult()!;
    expect(result.ok).toBe(false);
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.ok).toBe(false);
    expect(claudeResult.binaryCheck.error).toContain("Exit code 127");
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toBe("Skipped: binary check failed");
  });

  it("PreflightError.result lists only the failing runtimes in its message", async () => {
    const execute = buildExecuteMock({
      codexBinary: () => okResult("", { exitCode: 1, stderr: "nope" }),
    });
    const { check } = buildCheck(execute);

    try {
      await check.runPreflight();
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightError);
      expect((err as PreflightError).message).toContain("codex");
      expect((err as PreflightError).message).not.toContain("claude-code");
    }
  });

  it("marks binaryCheck as failed when the version probe times out", async () => {
    const execute = buildExecuteMock({
      claudeBinary: () => okResult("", { timedOut: true }),
    });
    const { check } = buildCheck(execute);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.ok).toBe(false);
    expect(claudeResult.binaryCheck.error).toContain("Timed out after");
  });

  it("marks binaryCheck as failed when execute() throws", async () => {
    const execute = buildExecuteMock({
      claudeBinary: () => {
        throw new Error("spawn failed");
      },
    });
    const { check } = buildCheck(execute);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.ok).toBe(false);
    expect(claudeResult.binaryCheck.error).toBe("spawn failed");
  });

  it("marks authCheck as failed when the auth probe times out", async () => {
    const execute = buildExecuteMock({
      claudeAuth: () => okResult("", { timedOut: true }),
    });
    const { check } = buildCheck(execute);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.ok).toBe(true);
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toContain("Auth probe timed out after");
  });

  it("marks authCheck as failed when successPattern does not match stdout/stderr", async () => {
    const execute = buildExecuteMock({
      claudeAuth: () => okResult('{"loggedIn": false}'),
    });
    const { check } = buildCheck(execute);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toContain("expected pattern not found");
  });

  it("passes authCheck via successPattern when the pattern matches stderr instead of stdout", async () => {
    const execute = buildExecuteMock({
      claudeAuth: () => ({ stdout: "", stderr: '"loggedIn": true', exitCode: 0, durationMs: 1, timedOut: false }),
    });
    const { check } = buildCheck(execute);

    const result = await check.runPreflight();
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(true);
  });

  it("marks authCheck as failed with exitCodeOnly semantics when exit code is non-zero (cursor-style config)", async () => {
    // Exercise the exitCodeOnly branch directly via a single-runtime config.
    const logger = makeMockLogger();
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.command === CLAUDE_CMD && opts.args[0] === "status") {
        return okResult("", { exitCode: 3, stderr: "denied" });
      }
      return okResult("", { stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": {
          command: CLAUDE_CMD,
          versionArgs: ["--version"],
          probeArgs: ["status"],
          exitCodeOnly: true,
        },
        codex: {
          command: CODEX_CMD,
          versionArgs: ["--version"],
          probeArgs: ["exec", "-"],
        },
        cursor: {
          command: CURSOR_CMD,
          versionArgs: ["--version"],
          probeArgs: ["status"],
        },
      } as never,
      logger as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toContain("Exit code 3");
  });

  it("exitCodeOnly passes when exit code is 0", async () => {
    const logger = makeMockLogger();
    const execute = vi.fn().mockResolvedValue(okResult(""));
    const check = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": {
          command: CLAUDE_CMD,
          versionArgs: ["--version"],
          probeArgs: ["status"],
          exitCodeOnly: true,
        },
        codex: {
          command: CODEX_CMD,
          versionArgs: ["--version"],
          probeArgs: ["exec", "-"],
          exitCodeOnly: true,
        },
        cursor: { command: CURSOR_CMD, versionArgs: ["--version"], probeArgs: ["status"] },
      } as never,
      logger as never,
    );

    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });

  it("default (pong) auth check fails with the exit-code message when exit is non-zero and no PONG is present", async () => {
    const execute = buildExecuteMock({
      codexAuth: () => okResult("", { exitCode: 1, stderr: "connection refused" }),
    });
    const { check } = buildCheck(execute);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(false);
    expect(codexResult.authCheck.error).toContain("Exit code 1");
  });

  it("default (pong) auth check fails with the no-pong message when exit is 0 but no PONG is present", async () => {
    const execute = buildExecuteMock({
      codexAuth: () => okResult("some unrelated chatter"),
    });
    const { check } = buildCheck(execute);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(false);
    expect(codexResult.authCheck.error).toContain("did not return expected response");
  });

  it("default (pong) auth check passes when PONG is present even with a non-zero exit code", async () => {
    const execute = buildExecuteMock({
      codexAuth: () => okResult("", { exitCode: 1, stdout: "noise PONG noise" }),
    });
    const { check } = buildCheck(execute);

    const result = await check.runPreflight();
    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(true);
  });

  it("marks authCheck as failed when execute() throws during the auth probe", async () => {
    const execute = buildExecuteMock({
      codexAuth: () => {
        throw new Error("auth probe exploded");
      },
    });
    const { check } = buildCheck(execute);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(false);
    expect(codexResult.authCheck.error).toBe("auth probe exploded");
  });

  it("stringifies a non-Error throw from the binary check", async () => {
    const execute = buildExecuteMock({
      claudeBinary: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "raw string failure";
      },
    });
    const { check } = buildCheck(execute);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.error).toBe("raw string failure");
  });

  it("stringifies a non-Error throw from the auth check", async () => {
    const execute = buildExecuteMock({
      codexAuth: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "raw auth failure";
      },
    });
    const { check } = buildCheck(execute);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.error).toBe("raw auth failure");
  });

  it("exitCodeOnly auth failure falls back to stdout when stderr is empty", async () => {
    const logger = makeMockLogger();
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.command === CLAUDE_CMD && opts.args[0] === "status") {
        return okResult("stdout failure detail", { exitCode: 5, stderr: "" });
      }
      return okResult("", { stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": {
          command: CLAUDE_CMD,
          versionArgs: ["--version"],
          probeArgs: ["status"],
          exitCodeOnly: true,
        },
        codex: { command: CODEX_CMD, versionArgs: ["--version"], probeArgs: ["exec", "-"] },
        cursor: { command: CURSOR_CMD, versionArgs: ["--version"], probeArgs: ["status"] },
      } as never,
      logger as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.error).toContain("stdout failure detail");
  });
});
