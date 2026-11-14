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

const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("configures claude-code with a loggedIn success pattern", () => {
    expect(configs["claude-code"]).toMatchObject({
      command: "claude",
      probeArgs: ["auth", "status"],
      successPattern: expect.stringContaining("loggedIn"),
    });
  });

  it("configures codex with a PONG stdin probe", () => {
    expect(configs.codex).toMatchObject({ command: "codex", probeStdin: "Respond with exactly: PONG" });
  });

  it("configures cursor to use exit-code-only auth checking", () => {
    expect(configs.cursor).toMatchObject({ command: "agent", exitCodeOnly: true });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes / getLastResult", () => {
  it("derives required runtimes from AGENT_STAGES (claude-code and codex, not cursor)", () => {
    const check = new RuntimeHealthCheck({} as never, configs, makeLogger() as never);
    const required = check.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });

  it("getLastResult is undefined before any preflight has run", () => {
    const check = new RuntimeHealthCheck({} as never, configs, makeLogger() as never);
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight", () => {
  it("passes and records the result when both binary and auth checks succeed", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation(({ command }: { command: string }) => {
        if (command === "claude") return Promise.resolve(makeResult({ stdout: '{"loggedIn": true}' }));
        if (command === "codex") return Promise.resolve(makeResult({ stdout: "PONG" }));
        return Promise.resolve(makeResult());
      }),
    };
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(check.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("throws a PreflightError carrying the failure details when a runtime fails", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation(({ command }: { command: string }) => {
        if (command === "claude") return Promise.resolve(makeResult({ exitCode: 1, stderr: "not found" }));
        return Promise.resolve(makeResult({ stdout: "PONG" }));
      }),
    };
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([expect.objectContaining({ runtime: "claude-code" })]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("skips the auth check when the binary check fails", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation(({ command, args }: { command: string; args: string[] }) => {
        if (command === "claude" && args[0] === "--version") {
          return Promise.resolve(makeResult({ exitCode: 127, stderr: "command not found" }));
        }
        return Promise.resolve(makeResult({ stdout: "PONG" }));
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    try {
      await check.runPreflight();
      throw new Error("expected runPreflight to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightError);
      const preflightErr = err as PreflightError;
      const claudeResult = preflightErr.result.results.find((r) => r.runtime === "claude-code");
      expect(claudeResult?.authCheck).toEqual({
        ok: false,
        durationMs: 0,
        error: "Skipped: binary check failed",
      });
    }
  });
});

describe("RuntimeHealthCheck binary check branches", () => {
  function singleRuntimeCheck(execute: ReturnType<typeof vi.fn>) {
    const scoped = { "claude-code": configs["claude-code"] } as typeof configs;
    return new (class extends RuntimeHealthCheck {
      getRequiredRuntimes() {
        return new Set<"claude-code">(["claude-code"]) as never;
      }
    })({ execute } as never, scoped, makeLogger() as never);
  }

  it("fails when the binary check times out", async () => {
    const execute = vi.fn().mockResolvedValue(makeResult({ timedOut: true }));
    const check = singleRuntimeCheck(execute);
    await expect(check.runPreflight()).rejects.toMatchObject({
      result: {
        results: [expect.objectContaining({ binaryCheck: expect.objectContaining({ ok: false, error: expect.stringContaining("Timed out") }) })],
      },
    });
  });

  it("fails and truncates stderr when the binary check exits non-zero", async () => {
    const execute = vi.fn().mockResolvedValue(makeResult({ exitCode: 1, stderr: "x".repeat(300) }));
    const check = singleRuntimeCheck(execute);
    await expect(check.runPreflight()).rejects.toMatchObject({
      result: {
        results: [
          expect.objectContaining({
            binaryCheck: expect.objectContaining({ ok: false }),
          }),
        ],
      },
    });
    const call = execute.mock.calls[0][0] as { args: string[] };
    expect(call.args).toEqual(["--version"]);
  });

  it("succeeds and extracts the first line of stdout as the version, truncated to 100 chars", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ stdout: `${"v".repeat(150)}\nextra line` }))
      .mockResolvedValue(makeResult({ stdout: '{"loggedIn": true}' }));
    const check = singleRuntimeCheck(execute);
    const result = await check.runPreflight();
    const binaryCheck = result.results[0].binaryCheck;
    expect(binaryCheck.ok).toBe(true);
    expect(binaryCheck.version).toHaveLength(100);
  });

  it("catches a rejected execute call and reports the error", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("spawn ENOENT"));
    const check = singleRuntimeCheck(execute);
    await expect(check.runPreflight()).rejects.toMatchObject({
      result: {
        results: [
          expect.objectContaining({
            binaryCheck: expect.objectContaining({ ok: false, error: "spawn ENOENT" }),
          }),
        ],
      },
    });
  });
});

describe("RuntimeHealthCheck auth check branches", () => {
  function patternRuntimeCheck(execute: ReturnType<typeof vi.fn>) {
    const scoped = { "claude-code": configs["claude-code"] } as typeof configs;
    return new (class extends RuntimeHealthCheck {
      getRequiredRuntimes() {
        return new Set<"claude-code">(["claude-code"]) as never;
      }
    })({ execute } as never, scoped, makeLogger() as never);
  }

  function exitCodeOnlyRuntimeCheck(execute: ReturnType<typeof vi.fn>) {
    const scoped = { cursor: configs.cursor } as typeof configs;
    return new (class extends RuntimeHealthCheck {
      getRequiredRuntimes() {
        return new Set<"cursor">(["cursor"]) as never;
      }
    })({ execute } as never, scoped, makeLogger() as never);
  }

  function pongRuntimeCheck(execute: ReturnType<typeof vi.fn>) {
    const scoped = { codex: configs.codex } as typeof configs;
    return new (class extends RuntimeHealthCheck {
      getRequiredRuntimes() {
        return new Set<"codex">(["codex"]) as never;
      }
    })({ execute } as never, scoped, makeLogger() as never);
  }

  it("auth check times out", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ stdout: "1.0.0" }))
      .mockResolvedValueOnce(makeResult({ timedOut: true }));
    const check = patternRuntimeCheck(execute);
    await expect(check.runPreflight()).rejects.toMatchObject({
      result: {
        results: [
          expect.objectContaining({
            authCheck: expect.objectContaining({ ok: false, error: expect.stringContaining("timed out") }),
          }),
        ],
      },
    });
  });

  it("successPattern fails to match the probe output", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ stdout: "1.0.0" }))
      .mockResolvedValueOnce(makeResult({ stdout: '{"loggedIn": false}' }));
    const check = patternRuntimeCheck(execute);
    await expect(check.runPreflight()).rejects.toMatchObject({
      result: {
        results: [
          expect.objectContaining({
            authCheck: expect.objectContaining({ ok: false, error: expect.stringContaining("expected pattern not found") }),
          }),
        ],
      },
    });
  });

  it("successPattern matches and passes", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ stdout: "1.0.0" }))
      .mockResolvedValueOnce(makeResult({ stdout: '{"loggedIn": true}' }));
    const check = patternRuntimeCheck(execute);
    const result = await check.runPreflight();
    expect(result.results[0].authCheck.ok).toBe(true);
  });

  it("exitCodeOnly passes on exit code 0 and fails on non-zero", async () => {
    const executeOk = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ stdout: "1.0.0" }))
      .mockResolvedValueOnce(makeResult({ exitCode: 0 }));
    const okCheck = exitCodeOnlyRuntimeCheck(executeOk);
    const okResult = await okCheck.runPreflight();
    expect(okResult.results[0].authCheck.ok).toBe(true);

    const executeFail = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ stdout: "1.0.0" }))
      .mockResolvedValueOnce(makeResult({ exitCode: 1, stderr: "denied" }));
    const failCheck = exitCodeOnlyRuntimeCheck(executeFail);
    await expect(failCheck.runPreflight()).rejects.toMatchObject({
      result: {
        results: [
          expect.objectContaining({
            authCheck: expect.objectContaining({ ok: false, error: expect.stringContaining("Exit code 1") }),
          }),
        ],
      },
    });
  });

  it("pong-based check passes when exit code is non-zero but PONG is present", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ stdout: "1.0.0" }))
      .mockResolvedValueOnce(makeResult({ exitCode: 1, stdout: "PONG" }));
    const check = pongRuntimeCheck(execute);
    const result = await check.runPreflight();
    expect(result.results[0].authCheck.ok).toBe(true);
  });

  it("pong-based check fails on non-zero exit code without PONG", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ stdout: "1.0.0" }))
      .mockResolvedValueOnce(makeResult({ exitCode: 1, stderr: "boom" }));
    const check = pongRuntimeCheck(execute);
    await expect(check.runPreflight()).rejects.toMatchObject({
      result: {
        results: [
          expect.objectContaining({
            authCheck: expect.objectContaining({ ok: false, error: expect.stringContaining("Exit code 1") }),
          }),
        ],
      },
    });
  });

  it("pong-based check fails on exit code 0 without PONG in output", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ stdout: "1.0.0" }))
      .mockResolvedValueOnce(makeResult({ exitCode: 0, stdout: "something else" }));
    const check = pongRuntimeCheck(execute);
    await expect(check.runPreflight()).rejects.toMatchObject({
      result: {
        results: [
          expect.objectContaining({
            authCheck: expect.objectContaining({ ok: false, error: expect.stringContaining("did not return expected response") }),
          }),
        ],
      },
    });
  });

  it("catches a rejected auth probe and reports the error", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ stdout: "1.0.0" }))
      .mockRejectedValueOnce(new Error("probe crashed"));
    const check = pongRuntimeCheck(execute);
    await expect(check.runPreflight()).rejects.toMatchObject({
      result: {
        results: [
          expect.objectContaining({
            authCheck: expect.objectContaining({ ok: false, error: "probe crashed" }),
          }),
        ],
      },
    });
  });
});
