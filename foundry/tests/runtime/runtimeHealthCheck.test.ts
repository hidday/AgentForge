import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

function makeMockProcessRunner() {
  return { execute: vi.fn() };
}

function makeConfigs() {
  return {
    "claude-code": {
      command: "claude",
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    },
    codex: {
      command: "codex",
      versionArgs: ["--version"],
      probeArgs: ["exec"],
      probeStdin: "Respond with exactly: PONG",
    },
    cursor: {
      command: "cursor-agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    },
  } as const;
}

function resultOf(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 10,
    timedOut: false,
    ...overrides,
  };
}

describe("RuntimeHealthCheck.getRequiredRuntimes", () => {
  it("derives required runtimes from AGENT_STAGES and excludes cursor (not used by any stage)", () => {
    const check = new RuntimeHealthCheck(
      makeMockProcessRunner() as never,
      makeConfigs(),
      makeMockLogger() as never,
    );

    const required = check.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });
});

describe("RuntimeHealthCheck.getLastResult", () => {
  it("is undefined before any preflight has run", () => {
    const check = new RuntimeHealthCheck(
      makeMockProcessRunner() as never,
      makeConfigs(),
      makeMockLogger() as never,
    );
    expect(check.getLastResult()).toBeUndefined();
  });

  it("caches the most recent preflight result after a successful run", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async ({ args }: { args: string[] }) => {
      if (args[0] === "--version") return resultOf({ stdout: "1.0.0\n" });
      if (args.includes("status")) return resultOf({ stdout: '{"loggedIn": true}' });
      return resultOf({ stdout: "PONG" });
    });

    const check = new RuntimeHealthCheck(
      processRunner as never,
      makeConfigs(),
      makeMockLogger() as never,
    );
    const result = await check.runPreflight();
    expect(check.getLastResult()).toBe(result);
  });
});

describe("RuntimeHealthCheck.runPreflight", () => {
  it("passes and logs success when every required runtime's binary + auth checks succeed", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async ({ command, args }: { command: string; args: string[] }) => {
      if (args[0] === "--version") return resultOf({ stdout: `${command} v1.2.3\n` });
      if (command === "claude") return resultOf({ stdout: '{"loggedIn": true}' });
      return resultOf({ stdout: "PONG" });
    });
    const logger = makeMockLogger();

    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);
    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"].sort());
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("throws PreflightError, logs failures, and skips the auth check when the binary check fails", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async ({ command, args }: { command: string; args: string[] }) => {
      if (command === "claude" && args[0] === "--version") {
        return resultOf({ exitCode: 127, stderr: "command not found" });
      }
      if (args[0] === "--version") return resultOf({ stdout: "1.0.0" });
      return resultOf({ stdout: "PONG" });
    });
    const logger = makeMockLogger();

    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    let thrown: unknown;
    try {
      await check.runPreflight();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(PreflightError);
    const preflightError = thrown as PreflightError;
    expect(preflightError.result.ok).toBe(false);

    const claudeResult = preflightError.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.ok).toBe(false);
    expect(claudeResult.authCheck).toEqual({
      ok: false,
      durationMs: 0,
      error: "Skipped: binary check failed",
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ runtime: "claude-code", binaryError: expect.any(String) }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("fails when the binary check passes but the auth check fails", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async ({ args }: { args: string[] }) => {
      if (args[0] === "--version") return resultOf({ stdout: "1.0.0" });
      return resultOf({ stdout: "not logged in", exitCode: 1 });
    });

    const check = new RuntimeHealthCheck(
      processRunner as never,
      makeConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
  });
});

describe("RuntimeHealthCheck binary + auth probe branches (via runPreflight with a single required runtime)", () => {
  function singleRuntimeCheck(
    runtime: AgentRuntime,
    config: ReturnType<typeof makeConfigs>[AgentRuntime],
    execute: ReturnType<typeof makeMockProcessRunner>["execute"],
  ) {
    // getRequiredRuntimes() is derived from AGENT_STAGES and always includes
    // claude-code + codex, so we exercise single-runtime branches directly
    // through the private probe methods via runPreflight's per-runtime results,
    // filtering the assertions down to the runtime under test.
    const processRunner = { execute };
    const configs = makeConfigs();
    (configs as unknown as Record<AgentRuntime, unknown>)[runtime] = config;
    return new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
  }

  it("binary check: marks ok with a trimmed version string on exit 0", async () => {
    const execute = vi.fn().mockResolvedValue(resultOf({ stdout: "claude 1.2.3\nextra line\n" }));
    const check = singleRuntimeCheck("claude-code", makeConfigs()["claude-code"], execute);
    const result = await check.runPreflight().catch((e: PreflightError) => e.result);
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.version).toBe("claude 1.2.3");
  });

  it("binary check: marks not-ok with a timeout message when the process times out", async () => {
    const execute = vi.fn().mockResolvedValue(resultOf({ timedOut: true }));
    const check = singleRuntimeCheck("claude-code", makeConfigs()["claude-code"], execute);
    const result = (await check.runPreflight().catch((e: PreflightError) => e.result)) as Awaited<
      ReturnType<RuntimeHealthCheck["runPreflight"]>
    >;
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(false);
    expect(claude.binaryCheck.error).toBe("Timed out after 5000ms");
  });

  it("binary check: catches a thrown error from processRunner.execute", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("spawn ENOENT"));
    const check = singleRuntimeCheck("claude-code", makeConfigs()["claude-code"], execute);
    const result = (await check.runPreflight().catch((e: PreflightError) => e.result)) as Awaited<
      ReturnType<RuntimeHealthCheck["runPreflight"]>
    >;
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(false);
    expect(claude.binaryCheck.error).toBe("spawn ENOENT");
  });

  it("binary check: stringifies a non-Error thrown value from processRunner.execute", async () => {
    // eslint-disable-next-line @typescript-eslint/no-throw-literal -- exercises the `err instanceof Error` false branch
    const execute = vi.fn().mockRejectedValue("raw string failure");
    const check = singleRuntimeCheck("claude-code", makeConfigs()["claude-code"], execute);
    const result = (await check.runPreflight().catch((e: PreflightError) => e.result)) as Awaited<
      ReturnType<RuntimeHealthCheck["runPreflight"]>
    >;
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(false);
    expect(claude.binaryCheck.error).toBe("raw string failure");
  });

  it("auth check: successPattern — fails with a descriptive error when the pattern doesn't match", async () => {
    const execute = vi.fn().mockImplementation(async ({ args }: { args: string[] }) => {
      if (args[0] === "--version") return resultOf({ stdout: "1.0" });
      return resultOf({ stdout: '{"loggedIn": false}' });
    });
    const check = singleRuntimeCheck("claude-code", makeConfigs()["claude-code"], execute);
    const result = (await check.runPreflight().catch((e: PreflightError) => e.result)) as Awaited<
      ReturnType<RuntimeHealthCheck["runPreflight"]>
    >;
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toContain("expected pattern not found");
  });

  it("auth check: exitCodeOnly — passes on exit 0 and fails on non-zero exit", async () => {
    const execOk = vi.fn().mockImplementation(async ({ args }: { args: string[] }) => {
      if (args[0] === "--version") return resultOf({ stdout: "1.0" });
      return resultOf({ exitCode: 0 });
    });
    const okCheck = singleRuntimeCheck("claude-code", makeConfigs().cursor, execOk);
    const okResult = (await okCheck.runPreflight().catch((e: PreflightError) => e.result)) as Awaited<
      ReturnType<RuntimeHealthCheck["runPreflight"]>
    >;
    expect(okResult.results.find((r) => r.runtime === "claude-code")!.authCheck.ok).toBe(true);

    const execFail = vi.fn().mockImplementation(async ({ args }: { args: string[] }) => {
      if (args[0] === "--version") return resultOf({ stdout: "1.0" });
      return resultOf({ exitCode: 2, stderr: "boom" });
    });
    const failCheck = singleRuntimeCheck("claude-code", makeConfigs().cursor, execFail);
    const failResult = (await failCheck
      .runPreflight()
      .catch((e: PreflightError) => e.result)) as Awaited<ReturnType<RuntimeHealthCheck["runPreflight"]>>;
    const authCheck = failResult.results.find((r) => r.runtime === "claude-code")!.authCheck;
    expect(authCheck.ok).toBe(false);
    expect(authCheck.error).toContain("Exit code 2");
  });

  it("auth check: exitCodeOnly — falls back to stdout in the error message when stderr is empty", async () => {
    const execute = vi.fn().mockImplementation(async ({ args }: { args: string[] }) => {
      if (args[0] === "--version") return resultOf({ stdout: "1.0" });
      return resultOf({ exitCode: 5, stderr: "", stdout: "stdout-explanation" });
    });
    const check = singleRuntimeCheck("claude-code", makeConfigs().cursor, execute);
    const result = (await check.runPreflight().catch((e: PreflightError) => e.result)) as Awaited<
      ReturnType<RuntimeHealthCheck["runPreflight"]>
    >;
    const authCheck = result.results.find((r) => r.runtime === "claude-code")!.authCheck;
    expect(authCheck.ok).toBe(false);
    expect(authCheck.error).toContain("stdout-explanation");
  });

  it("auth check: default pong pattern — passes when pong is present even with a non-zero exit code", async () => {
    const execute = vi.fn().mockImplementation(async ({ args }: { args: string[] }) => {
      if (args[0] === "--version") return resultOf({ stdout: "1.0" });
      return resultOf({ stdout: "PONG", exitCode: 1 });
    });
    const check = singleRuntimeCheck("claude-code", makeConfigs().codex, execute);
    const result = (await check.runPreflight().catch((e: PreflightError) => e.result)) as Awaited<
      ReturnType<RuntimeHealthCheck["runPreflight"]>
    >;
    expect(result.results.find((r) => r.runtime === "claude-code")!.authCheck.ok).toBe(true);
  });

  it("auth check: default pong pattern — fails with exit-code message when no pong and non-zero exit", async () => {
    const execute = vi.fn().mockImplementation(async ({ args }: { args: string[] }) => {
      if (args[0] === "--version") return resultOf({ stdout: "1.0" });
      return resultOf({ stdout: "nope", exitCode: 1, stderr: "oh no" });
    });
    const check = singleRuntimeCheck("claude-code", makeConfigs().codex, execute);
    const result = (await check.runPreflight().catch((e: PreflightError) => e.result)) as Awaited<
      ReturnType<RuntimeHealthCheck["runPreflight"]>
    >;
    const authCheck = result.results.find((r) => r.runtime === "claude-code")!.authCheck;
    expect(authCheck.ok).toBe(false);
    expect(authCheck.error).toContain("Exit code 1");
  });

  it("auth check: default pong pattern — fails with a generic message when exit is 0 but no pong appears", async () => {
    const execute = vi.fn().mockImplementation(async ({ args }: { args: string[] }) => {
      if (args[0] === "--version") return resultOf({ stdout: "1.0" });
      return resultOf({ stdout: "ok but silent", exitCode: 0 });
    });
    const check = singleRuntimeCheck("claude-code", makeConfigs().codex, execute);
    const result = (await check.runPreflight().catch((e: PreflightError) => e.result)) as Awaited<
      ReturnType<RuntimeHealthCheck["runPreflight"]>
    >;
    const authCheck = result.results.find((r) => r.runtime === "claude-code")!.authCheck;
    expect(authCheck.ok).toBe(false);
    expect(authCheck.error).toContain("did not return expected response");
  });

  it("auth check: times out and reports a timeout message", async () => {
    const execute = vi.fn().mockImplementation(async ({ args }: { args: string[] }) => {
      if (args[0] === "--version") return resultOf({ stdout: "1.0" });
      return resultOf({ timedOut: true });
    });
    const check = singleRuntimeCheck("claude-code", makeConfigs().codex, execute);
    const result = (await check.runPreflight().catch((e: PreflightError) => e.result)) as Awaited<
      ReturnType<RuntimeHealthCheck["runPreflight"]>
    >;
    const authCheck = result.results.find((r) => r.runtime === "claude-code")!.authCheck;
    expect(authCheck.ok).toBe(false);
    expect(authCheck.error).toBe("Auth probe timed out after 30000ms");
  });

  it("auth check: catches a thrown error from processRunner.execute", async () => {
    const execute = vi.fn().mockImplementation(async ({ args }: { args: string[] }) => {
      if (args[0] === "--version") return resultOf({ stdout: "1.0" });
      throw new Error("pipe broke");
    });
    const check = singleRuntimeCheck("claude-code", makeConfigs().codex, execute);
    const result = (await check.runPreflight().catch((e: PreflightError) => e.result)) as Awaited<
      ReturnType<RuntimeHealthCheck["runPreflight"]>
    >;
    const authCheck = result.results.find((r) => r.runtime === "claude-code")!.authCheck;
    expect(authCheck.ok).toBe(false);
    expect(authCheck.error).toBe("pipe broke");
  });

  it("auth check: stringifies a non-Error thrown value from processRunner.execute", async () => {
    const execute = vi.fn().mockImplementation(async ({ args }: { args: string[] }) => {
      if (args[0] === "--version") return resultOf({ stdout: "1.0" });
      // eslint-disable-next-line @typescript-eslint/no-throw-literal -- exercises the `err instanceof Error` false branch
      throw "raw auth failure";
    });
    const check = singleRuntimeCheck("claude-code", makeConfigs().codex, execute);
    const result = (await check.runPreflight().catch((e: PreflightError) => e.result)) as Awaited<
      ReturnType<RuntimeHealthCheck["runPreflight"]>
    >;
    const authCheck = result.results.find((r) => r.runtime === "claude-code")!.authCheck;
    expect(authCheck.ok).toBe(false);
    expect(authCheck.error).toBe("raw auth failure");
  });
});

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds configs for all three runtimes with the right probe shape per runtime", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--base"],
      "codex",
      ["exec"],
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
      probeArgs: ["exec"],
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

describe("RuntimeHealthCheck integration smoke test", () => {
  it("instantiates with configs built from buildRuntimeConfigs and runs a full preflight", async () => {
    const execute = vi.fn().mockImplementation(async ({ command, args }: { command: string; args: string[] }) => {
      if (args[0] === "--version") return resultOf({ stdout: `${command} 1.0.0` });
      if (command === "claude") return resultOf({ stdout: '{"loggedIn":true}' });
      return resultOf({ stdout: "PONG" });
    });
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec"], "cursor-agent");
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });
});
