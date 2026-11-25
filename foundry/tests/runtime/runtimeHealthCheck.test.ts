import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import { AGENT_STAGES } from "../../src/domain/types.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 10,
    timedOut: false,
    ...overrides,
  };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds configs for all three runtimes with the expected probe shapes", () => {
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
  it("returns the set of runtimes referenced by AGENT_STAGES", () => {
    const processRunner = { execute: vi.fn() };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec"], "cursor");
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    const required = check.getRequiredRuntimes();
    const expected = new Set(Object.values(AGENT_STAGES).map((s) => s.runtime));
    expect(required).toEqual(expected);
  });
});

describe("RuntimeHealthCheck.getLastResult", () => {
  it("returns undefined before runPreflight has ever run", () => {
    const processRunner = { execute: vi.fn() };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec"], "cursor");
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight", () => {
  let configs: Record<"claude-code" | "codex" | "cursor", ReturnType<typeof RuntimeHealthCheck.buildRuntimeConfigs>[keyof ReturnType<typeof RuntimeHealthCheck.buildRuntimeConfigs>]>;

  beforeEach(() => {
    configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      [],
      "codex",
      ["exec", "-"],
      "cursor-agent",
    ) as never;
  });

  it("resolves ok:true when binary and auth checks pass for every required runtime", async () => {
    const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") {
        return Promise.resolve(makeResult({ stdout: "v1.0.0\n" }));
      }
      if (opts.command === "claude") {
        return Promise.resolve(makeResult({ stdout: '{"loggedIn": true}' }));
      }
      if (opts.command === "codex") {
        return Promise.resolve(makeResult({ stdout: "PONG" }));
      }
      // cursor status probe: exitCodeOnly
      return Promise.resolve(makeResult({ exitCode: 0 }));
    });
    const processRunner = { execute };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(result.requiredRuntimes.length);
    expect(check.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("throws PreflightError and logs failures when a runtime is not authenticated", async () => {
    const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") {
        return Promise.resolve(makeResult({ stdout: "v1.0.0\n" }));
      }
      if (opts.command === "claude") {
        // Auth probe returns loggedIn: false -> successPattern doesn't match.
        return Promise.resolve(makeResult({ stdout: '{"loggedIn": false}' }));
      }
      if (opts.command === "codex") {
        return Promise.resolve(makeResult({ stdout: "PONG" }));
      }
      return Promise.resolve(makeResult({ exitCode: 0 }));
    });
    const processRunner = { execute };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([expect.objectContaining({ runtime: "claude-code" })]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
    // lastResult is still recorded even though the call throws.
    expect(check.getLastResult()?.ok).toBe(false);
  });

  it("skips the auth probe and reports failure when the binary check fails", async () => {
    const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
      if (opts.args[0] === "--version") {
        return Promise.resolve(makeResult({ exitCode: 1, stderr: "command not found" }));
      }
      throw new Error("auth probe should not run when binary check fails");
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    const preflightError = await check.runPreflight().catch((e) => e as PreflightError);
    expect(preflightError).toBeInstanceOf(PreflightError);
    const failed = preflightError.result.results.find((r) => !r.binaryCheck.ok);
    expect(failed?.authCheck.ok).toBe(false);
    expect(failed?.authCheck.error).toBe("Skipped: binary check failed");
  });

  it("reports a binary check failure with a timeout message when the version probe times out", async () => {
    const execute = vi.fn().mockResolvedValue(makeResult({ timedOut: true }));
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    const err = await check.runPreflight().catch((e) => e as PreflightError);
    expect(err).toBeInstanceOf(PreflightError);
    const anyResult = err.result.results[0];
    expect(anyResult.binaryCheck.ok).toBe(false);
    expect(anyResult.binaryCheck.error).toContain("Timed out after");
  });

  it("reports a binary check failure when the version probe rejects", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("ENOENT: command not found"));
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    const err = await check.runPreflight().catch((e) => e as PreflightError);
    expect(err).toBeInstanceOf(PreflightError);
    expect(err.result.results[0].binaryCheck.error).toBe("ENOENT: command not found");
  });

  it("reports an auth check failure with a timeout message when the auth probe times out", async () => {
    const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
      if (opts.args[0] === "--version") return Promise.resolve(makeResult({ stdout: "v1" }));
      return Promise.resolve(makeResult({ timedOut: true }));
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    const err = await check.runPreflight().catch((e) => e as PreflightError);
    expect(err).toBeInstanceOf(PreflightError);
    const failing = err.result.results.find((r) => !r.authCheck.ok);
    expect(failing?.authCheck.error).toContain("Auth probe timed out after");
  });

  it("reports an auth check failure when the auth probe rejects", async () => {
    const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
      if (opts.args[0] === "--version") return Promise.resolve(makeResult({ stdout: "v1" }));
      return Promise.reject(new Error("socket hang up"));
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    const err = await check.runPreflight().catch((e) => e as PreflightError);
    expect(err).toBeInstanceOf(PreflightError);
    const failing = err.result.results.find((r) => !r.authCheck.ok);
    expect(failing?.authCheck.error).toBe("socket hang up");
  });

  it("fails an exitCodeOnly auth probe on non-zero exit code", async () => {
    // "cursor" is not one of the runtimes AGENT_STAGES requires, so its
    // exitCodeOnly probe branch is otherwise unreachable via runPreflight.
    // Reconfigure the (required) codex runtime to use that same probe style
    // to exercise the branch deterministically.
    const exitCodeOnlyConfigs = {
      ...configs,
      codex: { command: "codex", versionArgs: ["--version"], probeArgs: ["status"], exitCodeOnly: true },
    };
    const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return Promise.resolve(makeResult({ stdout: "v1" }));
      if (opts.command === "claude") return Promise.resolve(makeResult({ stdout: '{"loggedIn": true}' }));
      return Promise.resolve(makeResult({ exitCode: 1, stderr: "not logged in" }));
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      exitCodeOnlyConfigs as never,
      makeMockLogger() as never,
    );

    const err = await check.runPreflight().catch((e) => e as PreflightError);
    expect(err).toBeInstanceOf(PreflightError);
    const codexResult = err.result.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("Exit code 1");
  });

  it("passes an exitCodeOnly auth probe on exit code 0", async () => {
    const exitCodeOnlyConfigs = {
      ...configs,
      codex: { command: "codex", versionArgs: ["--version"], probeArgs: ["status"], exitCodeOnly: true },
    };
    const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return Promise.resolve(makeResult({ stdout: "v1" }));
      if (opts.command === "claude") return Promise.resolve(makeResult({ stdout: '{"loggedIn": true}' }));
      return Promise.resolve(makeResult({ exitCode: 0 }));
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      exitCodeOnlyConfigs as never,
      makeMockLogger() as never,
    );

    const result = await check.runPreflight();
    const codexResult = result.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(true);
  });

  it("passes a PONG-style auth probe (codex) even on a non-zero exit code when PONG is present", async () => {
    const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return Promise.resolve(makeResult({ stdout: "v1" }));
      if (opts.command === "claude") return Promise.resolve(makeResult({ stdout: '{"loggedIn": true}' }));
      if (opts.command === "codex") {
        return Promise.resolve(makeResult({ exitCode: 1, stdout: "noisy PONG output" }));
      }
      return Promise.resolve(makeResult({ exitCode: 0 }));
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    const result = await check.runPreflight();
    const codexResult = result.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(true);
  });

  it("fails a PONG-style auth probe (codex) when exit code is non-zero and no PONG is found", async () => {
    const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return Promise.resolve(makeResult({ stdout: "v1" }));
      if (opts.command === "claude") return Promise.resolve(makeResult({ stdout: '{"loggedIn": true}' }));
      if (opts.command === "codex") {
        return Promise.resolve(makeResult({ exitCode: 1, stderr: "connection refused" }));
      }
      return Promise.resolve(makeResult({ exitCode: 0 }));
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    const err = await check.runPreflight().catch((e) => e as PreflightError);
    expect(err).toBeInstanceOf(PreflightError);
    const codexResult = err.result.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("Exit code 1");
  });

  it("fails a PONG-style auth probe (codex) when exit code is zero but no PONG is found", async () => {
    const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return Promise.resolve(makeResult({ stdout: "v1" }));
      if (opts.command === "claude") return Promise.resolve(makeResult({ stdout: '{"loggedIn": true}' }));
      if (opts.command === "codex") {
        return Promise.resolve(makeResult({ exitCode: 0, stdout: "unexpected reply" }));
      }
      return Promise.resolve(makeResult({ exitCode: 0 }));
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    const err = await check.runPreflight().catch((e) => e as PreflightError);
    expect(err).toBeInstanceOf(PreflightError);
    const codexResult = err.result.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("did not return expected response");
  });

  it("passes config.probeStdin through to the auth probe call for codex", async () => {
    const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return Promise.resolve(makeResult({ stdout: "v1" }));
      if (opts.command === "claude") return Promise.resolve(makeResult({ stdout: '{"loggedIn": true}' }));
      if (opts.command === "codex") return Promise.resolve(makeResult({ stdout: "PONG" }));
      return Promise.resolve(makeResult({ exitCode: 0 }));
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    await check.runPreflight();

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "codex",
        args: ["exec", "-"],
        stdinData: "Respond with exactly: PONG",
      }),
    );
  });
});
