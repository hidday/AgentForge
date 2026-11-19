import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeProcessRunner() {
  return { execute: vi.fn() };
}

const claudeConfig = {
  command: "claude",
  versionArgs: ["--version"],
  probeArgs: ["auth", "status"],
  successPattern: '"loggedIn":\\s*true',
};
const codexConfig = {
  command: "codex",
  versionArgs: ["--version"],
  probeArgs: ["exec", "-"],
  probeStdin: "Respond with exactly: PONG",
};
const cursorConfig = {
  command: "agent",
  versionArgs: ["--version"],
  probeArgs: ["status"],
  exitCodeOnly: true,
};

function makeConfigs() {
  return {
    "claude-code": claudeConfig,
    codex: codexConfig,
    cursor: cursorConfig,
  } as never;
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds configs for all three runtimes with the expected probe shapes", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      [],
      "codex",
      ["exec", "-"],
      "agent",
    );
    expect(configs["claude-code"]).toMatchObject({
      command: "claude",
      successPattern: expect.any(String),
    });
    expect(configs.codex).toMatchObject({ command: "codex", probeStdin: expect.any(String) });
    expect(configs.cursor).toMatchObject({ command: "agent", exitCodeOnly: true });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes / getLastResult", () => {
  it("derives required runtimes from AGENT_STAGES (claude-code and codex, not cursor)", () => {
    const check = new RuntimeHealthCheck(
      makeProcessRunner() as never,
      makeConfigs(),
      makeLogger() as never,
    );
    const required = check.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });

  it("returns undefined before any preflight has run", () => {
    const check = new RuntimeHealthCheck(
      makeProcessRunner() as never,
      makeConfigs(),
      makeLogger() as never,
    );
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight", () => {
  it("passes and records skippedRuntimes=['cursor'] when all required runtimes are healthy", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(
      async ({ command, args }: { command: string; args: string[] }) => {
        if (args.includes("--version")) {
          return {
            stdout: `${command} v1.0.0`,
            stderr: "",
            exitCode: 0,
            durationMs: 5,
            timedOut: false,
          };
        }
        if (command === "claude") {
          return {
            stdout: '{"loggedIn": true}',
            stderr: "",
            exitCode: 0,
            durationMs: 5,
            timedOut: false,
          };
        }
        return { stdout: "PONG", stderr: "", exitCode: 0, durationMs: 5, timedOut: false };
      },
    );
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect([...result.requiredRuntimes].sort()).toEqual(["claude-code", "codex"]);
    expect(check.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("throws PreflightError and logs failures when a binary check fails", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(
      async ({ command, args }: { command: string; args: string[] }) => {
        if (command === "claude" && args.includes("--version")) {
          return {
            stdout: "",
            stderr: "command not found",
            exitCode: 127,
            durationMs: 5,
            timedOut: false,
          };
        }
        if (args.includes("--version")) {
          return {
            stdout: `${command} v1.0.0`,
            stderr: "",
            exitCode: 0,
            durationMs: 5,
            timedOut: false,
          };
        }
        return { stdout: "PONG", stderr: "", exitCode: 0, durationMs: 5, timedOut: false };
      },
    );
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({
            runtime: "claude-code",
            binaryError: expect.stringContaining("Exit code 127"),
          }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("skips the auth check (with a descriptive error) when the binary check fails", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async ({ args }: { args: string[] }) => {
      if (args.includes("--version")) {
        return { stdout: "", stderr: "", exitCode: 1, durationMs: 5, timedOut: false };
      }
      throw new Error("auth probe should never be called when binary check fails");
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      makeConfigs(),
      makeLogger() as never,
    );

    let caught: unknown;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PreflightError);
    const result = (caught as PreflightError).result;
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck).toEqual({
      ok: false,
      durationMs: 0,
      error: "Skipped: binary check failed",
    });
  });
});

describe("RuntimeHealthCheck private probe branches (direct access for full edge-case coverage)", () => {
  interface PrivateProbe {
    checkBinary: (
      config: unknown,
    ) => Promise<{ ok: boolean; version?: string; error?: string; durationMs: number }>;
    checkAuth: (
      config: unknown,
    ) => Promise<{ ok: boolean; durationMs: number; error?: string }>;
  }

  function makeCheck(processRunner: ReturnType<typeof makeProcessRunner>): PrivateProbe {
    return new RuntimeHealthCheck(
      processRunner as never,
      makeConfigs(),
      makeLogger() as never,
    ) as unknown as PrivateProbe;
  }

  it("checkBinary: reports a timeout", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 1,
      durationMs: 5000,
      timedOut: true,
    });
    const check = makeCheck(processRunner);
    const result = await check.checkBinary(claudeConfig);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Timed out after");
  });

  it("checkBinary: captures thrown errors from the process runner", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockRejectedValue(new Error("ENOENT"));
    const check = makeCheck(processRunner);
    const result = await check.checkBinary(claudeConfig);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("ENOENT");
  });

  it("checkBinary: succeeds and extracts the first line of stdout as the version", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue({
      stdout: "claude v9.9.9\nextra",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    });
    const check = makeCheck(processRunner);
    const result = await check.checkBinary(claudeConfig);
    expect(result).toEqual({ ok: true, version: "claude v9.9.9", durationMs: 5 });
  });

  it("checkAuth: successPattern not matched in output", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue({
      stdout: '{"loggedIn": false}',
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    });
    const check = makeCheck(processRunner);
    const result = await check.checkAuth(claudeConfig);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("expected pattern not found");
  });

  it("checkAuth: exitCodeOnly passes on exit 0", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    });
    const check = makeCheck(processRunner);
    const result = await check.checkAuth(cursorConfig);
    expect(result).toEqual({ ok: true, durationMs: 5 });
  });

  it("checkAuth: exitCodeOnly fails on non-zero exit", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue({
      stdout: "",
      stderr: "not logged in",
      exitCode: 1,
      durationMs: 5,
      timedOut: false,
    });
    const check = makeCheck(processRunner);
    const result = await check.checkAuth(cursorConfig);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Exit code 1");
  });

  it("checkAuth: default PONG path succeeds even on non-zero exit if PONG is present", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue({
      stdout: "pong",
      stderr: "",
      exitCode: 1,
      durationMs: 5,
      timedOut: false,
    });
    const check = makeCheck(processRunner);
    const result = await check.checkAuth(codexConfig);
    expect(result).toEqual({ ok: true, durationMs: 5 });
  });

  it("checkAuth: default path fails when exit is non-zero and PONG is absent", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue({
      stdout: "",
      stderr: "boom",
      exitCode: 1,
      durationMs: 5,
      timedOut: false,
    });
    const check = makeCheck(processRunner);
    const result = await check.checkAuth(codexConfig);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Exit code 1");
  });

  it("checkAuth: default path fails when exit is 0 but PONG is absent", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue({
      stdout: "nothing useful",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    });
    const check = makeCheck(processRunner);
    const result = await check.checkAuth(codexConfig);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("did not return expected response");
  });

  it("checkAuth: reports a timeout", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 1,
      durationMs: 30000,
      timedOut: true,
    });
    const check = makeCheck(processRunner);
    const result = await check.checkAuth(codexConfig);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Auth probe timed out after");
  });

  it("checkAuth: captures thrown errors from the process runner", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockRejectedValue(new Error("spawn EACCES"));
    const check = makeCheck(processRunner);
    const result = await check.checkAuth(codexConfig);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("spawn EACCES");
  });
});
