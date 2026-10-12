import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck, type RuntimeProbeResult } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeMockProcessRunner() {
  return { execute: vi.fn() };
}

function okResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 1, timedOut: false, ...overrides };
}

const claudeAuthOk = okResult({ stdout: '{"loggedIn": true}' });
const claudeAuthBad = okResult({ stdout: '{"loggedIn": false}' });
const codexPongOk = okResult({ stdout: "PONG" });
const cursorStatusOk = okResult({ exitCode: 0, stdout: "ok" });

function buildConfigs() {
  return RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds the expected per-runtime probe configuration", () => {
    const configs = buildConfigs();

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

describe("RuntimeHealthCheck.getRequiredRuntimes", () => {
  it("returns the distinct set of runtimes used by AGENT_STAGES", () => {
    const check = new RuntimeHealthCheck(
      makeMockProcessRunner() as never,
      buildConfigs(),
      makeMockLogger() as never,
    );
    const required = check.getRequiredRuntimes();
    // AGENT_STAGES currently only routes through claude-code and codex.
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
  });
});

describe("RuntimeHealthCheck.getLastResult", () => {
  it("is undefined before runPreflight has ever run", () => {
    const check = new RuntimeHealthCheck(
      makeMockProcessRunner() as never,
      buildConfigs(),
      makeMockLogger() as never,
    );
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight: healthy paths", () => {
  it("reports ok=true when every required runtime's binary and auth checks pass", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.2.3\n" });
      if (opts.command === "claude") return claudeAuthOk;
      if (opts.command === "codex") return codexPongOk;
      return cursorStatusOk;
    });

    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, buildConfigs(), logger as never);
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
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("uses exitCodeOnly auth semantics for the cursor runtime (pass on exit 0)", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "9.9.9" });
      return cursorStatusOk;
    });
    const configs = buildConfigs();
    const check = new RuntimeHealthCheck(
      processRunner as never,
      configs,
      makeMockLogger() as never,
    );

    // Directly probe the cursor runtime config, since it is not part of
    // AGENT_STAGES and therefore not exercised by runPreflight().
    const probe = await (check as unknown as {
      probeRuntime: (r: AgentRuntime) => Promise<RuntimeProbeResult>;
    }).probeRuntime("cursor");

    expect(probe.binaryCheck.ok).toBe(true);
    expect(probe.authCheck.ok).toBe(true);
  });
});

describe("RuntimeHealthCheck.runPreflight: binary check failures", () => {
  it("fails with timeout error when the version probe times out, and skips the auth probe", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args[0] === "--version") {
        return okResult({ timedOut: true, stdout: "", stderr: "" });
      }
      return claudeAuthOk;
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, buildConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);

    const result = check.getLastResult()!;
    expect(result.ok).toBe(false);
    for (const r of result.results) {
      expect(r.binaryCheck.ok).toBe(false);
      expect(r.binaryCheck.error).toMatch(/Timed out after \d+ms/);
      expect(r.authCheck.ok).toBe(false);
      expect(r.authCheck.error).toBe("Skipped: binary check failed");
    }
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("fails with a non-zero exit error when the version command exits non-zero", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args[0] === "--version") {
        return okResult({ exitCode: 127, stderr: "command not found: claude" });
      }
      return claudeAuthOk;
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const result = check.getLastResult()!;
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.ok).toBe(false);
    expect(claudeResult.binaryCheck.error).toContain("Exit code 127");
    expect(claudeResult.binaryCheck.error).toContain("command not found: claude");
  });

  it("fails with the thrown error's message when the binary probe itself throws (e.g. ENOENT)", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args[0] === "--version") {
        throw new Error(`spawn ${opts.command} ENOENT`);
      }
      return claudeAuthOk;
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const result = check.getLastResult()!;
    for (const r of result.results) {
      expect(r.binaryCheck.ok).toBe(false);
      expect(r.binaryCheck.error).toMatch(/ENOENT/);
    }
  });

  it("stringifies a non-Error throw from the binary probe", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args[0] === "--version") {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "raw string failure";
      }
      return claudeAuthOk;
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const result = check.getLastResult()!;
    expect(result.results[0]!.binaryCheck.error).toBe("raw string failure");
  });

  it("truncates the version string to the first line and 100 characters", async () => {
    const processRunner = makeMockProcessRunner();
    const longLine = "v".repeat(150);
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") {
        return okResult({ stdout: `${longLine}\nextra line` });
      }
      return opts.command === "claude" ? claudeAuthOk : codexPongOk;
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      makeMockLogger() as never,
    );
    await check.runPreflight();
    const result = check.getLastResult()!;
    for (const r of result.results) {
      expect(r.binaryCheck.version).toBe(longLine.slice(0, 100));
      expect(r.binaryCheck.version).not.toContain("extra line");
    }
  });
});

describe("RuntimeHealthCheck.runPreflight: auth check failures", () => {
  it("fails when the auth probe times out", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      return okResult({ timedOut: true });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const result = check.getLastResult()!;
    for (const r of result.results) {
      expect(r.authCheck.ok).toBe(false);
      expect(r.authCheck.error).toMatch(/Auth probe timed out after \d+ms/);
    }
  });

  it("fails claude-code's successPattern auth check when loggedIn is false", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      if (opts.command === "claude") return claudeAuthBad;
      return codexPongOk;
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const result = check.getLastResult()!;
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toContain("expected pattern not found in output");

    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(true);
  });

  it("matches claude-code's successPattern against stderr as well as stdout", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      if (opts.command === "claude") {
        return okResult({ stdout: "", stderr: '{"loggedIn": true}' });
      }
      return codexPongOk;
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      makeMockLogger() as never,
    );
    const result = await check.runPreflight();
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(true);
  });

  it("fails cursor's exitCodeOnly auth check on a non-zero exit code", async () => {
    const processRunner = makeMockProcessRunner();
    const configs = buildConfigs();
    const check = new RuntimeHealthCheck(
      processRunner as never,
      configs,
      makeMockLogger() as never,
    );

    processRunner.execute.mockResolvedValueOnce(okResult({ stdout: "1.0.0" })); // binary check
    processRunner.execute.mockResolvedValueOnce(
      okResult({ exitCode: 1, stderr: "not logged in" }),
    ); // auth check

    const probe = await (check as unknown as {
      probeRuntime: (r: AgentRuntime) => Promise<RuntimeProbeResult>;
    }).probeRuntime("cursor");

    expect(probe.authCheck.ok).toBe(false);
    expect(probe.authCheck.error).toContain("Exit code 1");
    expect(probe.authCheck.error).toContain("not logged in");
  });

  it("falls back to stdout text in the exitCodeOnly error message when stderr is empty", async () => {
    const processRunner = makeMockProcessRunner();
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      makeMockLogger() as never,
    );
    processRunner.execute.mockResolvedValueOnce(okResult({ stdout: "1.0.0" }));
    processRunner.execute.mockResolvedValueOnce(
      okResult({ exitCode: 1, stderr: "", stdout: "denied" }),
    );

    const probe = await (check as unknown as {
      probeRuntime: (r: AgentRuntime) => Promise<RuntimeProbeResult>;
    }).probeRuntime("cursor");

    expect(probe.authCheck.error).toContain("denied");
  });

  it("fails codex's PONG-based auth check on non-zero exit without a pong in the output", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      if (opts.command === "codex") {
        return okResult({ exitCode: 1, stderr: "connection refused" });
      }
      return claudeAuthOk;
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const result = check.getLastResult()!;
    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(false);
    expect(codexResult.authCheck.error).toContain("Exit code 1");
    expect(codexResult.authCheck.error).toContain("connection refused");
  });

  it("passes codex's PONG-based auth check on non-zero exit if PONG is still present in output", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      if (opts.command === "codex") {
        return okResult({ exitCode: 1, stdout: "partial PONG before crash", stderr: "crash" });
      }
      return claudeAuthOk;
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      makeMockLogger() as never,
    );
    const result = await check.runPreflight();
    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(true);
  });

  it("fails codex's PONG-based auth check on exit 0 when no pong is present in the output", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      if (opts.command === "codex") {
        return okResult({ exitCode: 0, stdout: "I am fine thanks" });
      }
      return claudeAuthOk;
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const result = check.getLastResult()!;
    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(false);
    expect(codexResult.authCheck.error).toContain("did not return expected response");
  });

  it("reports err.message when the auth probe throws a real Error instance", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      throw new Error("auth socket reset");
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const result = check.getLastResult()!;
    expect(result.results[0]!.authCheck.error).toBe("auth socket reset");
  });

  it("stringifies a non-Error throw from the auth probe", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "auth probe exploded";
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const result = check.getLastResult()!;
    expect(result.results[0]!.authCheck.error).toBe("auth probe exploded");
  });

  it("passes the auth probe's stdinData through from probeStdin for codex", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      return opts.command === "claude" ? claudeAuthOk : codexPongOk;
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      makeMockLogger() as never,
    );
    await check.runPreflight();

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "codex",
        args: ["exec", "-"],
        stdinData: "Respond with exactly: PONG",
      }),
    );
  });
});

describe("RuntimeHealthCheck.runPreflight: result aggregation", () => {
  it("aggregates a PreflightError whose result lists every failing runtime", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      if (opts.command === "claude") return claudeAuthBad;
      return okResult({ exitCode: 1, stderr: "codex down" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      makeMockLogger() as never,
    );

    let caught: unknown;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PreflightError);
    const err = caught as PreflightError;
    expect(err.message).toContain("claude-code");
    expect(err.message).toContain("codex");
    expect(err.result.ok).toBe(false);
    expect(err.result.results).toHaveLength(2);
  });
});
