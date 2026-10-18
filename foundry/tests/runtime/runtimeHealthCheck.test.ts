import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeMockProcessRunner() {
  return { execute: vi.fn() };
}

function okResult(stdout = "", stderr = ""): ProcessResult {
  return { stdout, stderr, exitCode: 0, durationMs: 1, timedOut: false };
}

function failResult(exitCode = 1, stderr = "boom"): ProcessResult {
  return { stdout: "", stderr, exitCode, durationMs: 1, timedOut: false };
}

function timedOutResult(): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 1, durationMs: 1, timedOut: true };
}

/** A minimal config set: "claude-code" and "codex" are the only runtimes ever
 * probed by runPreflight() since AGENT_STAGES only references those two. */
function makeConfigs() {
  return RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
}

describe("RuntimeHealthCheck.getRequiredRuntimes", () => {
  it("returns exactly the runtimes referenced by AGENT_STAGES (claude-code and codex)", () => {
    const processRunner = makeMockProcessRunner();
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    const required = check.getRequiredRuntimes();
    expect(required).toEqual(new Set<AgentRuntime>(["claude-code", "codex"]));
  });
});

describe("RuntimeHealthCheck.getLastResult", () => {
  it("is undefined before any preflight has run", () => {
    const processRunner = makeMockProcessRunner();
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight", () => {
  it("passes when every required runtime's binary and auth checks succeed", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts) => {
      if (opts.args.includes("--version")) return okResult("1.2.3");
      if (opts.args.includes("auth")) return okResult('{"loggedIn": true}');
      // codex probe, exitCodeOnly false, default pong path
      return okResult("PONG");
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(check.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("throws PreflightError when a binary check fails, and skips the auth check for that runtime", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts) => {
      if (opts.command === "claude" && opts.args.includes("--version")) {
        return failResult(127, "command not found");
      }
      if (opts.args.includes("--version")) return okResult("1.0.0");
      return okResult("PONG");
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const stored = check.getLastResult();
    expect(stored?.ok).toBe(false);
    const claudeResult = stored?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toContain("Exit code 127");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toBe("Skipped: binary check failed");
    expect(logger.error).toHaveBeenCalled();
  });

  it("reports a binary check timeout distinctly from a non-zero exit code", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts) => {
      if (opts.args.includes("--version")) return timedOutResult();
      return okResult("PONG");
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const stored = check.getLastResult();
    const r = stored?.results.find((x) => x.runtime === "claude-code");
    expect(r?.binaryCheck.ok).toBe(false);
    expect(r?.binaryCheck.error).toContain("Timed out after");
  });

  it("marks the binary check failed when processRunner.execute throws", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts) => {
      if (opts.args.includes("--version")) throw new Error("spawn EACCES");
      return okResult("PONG");
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const r = check.getLastResult()?.results.find((x) => x.runtime === "claude-code");
    expect(r?.binaryCheck.ok).toBe(false);
    expect(r?.binaryCheck.error).toBe("spawn EACCES");
  });

  it("fails auth when the successPattern does not match the probe output", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts) => {
      if (opts.args.includes("--version")) return okResult("1.0.0");
      if (opts.args.includes("auth")) return okResult('{"loggedIn": false}');
      return okResult("PONG");
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const r = check.getLastResult()?.results.find((x) => x.runtime === "claude-code");
    expect(r?.authCheck.ok).toBe(false);
    expect(r?.authCheck.error).toContain("expected pattern not found");
  });

  it("marks auth check failed when the auth probe times out", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts) => {
      if (opts.args.includes("--version")) return okResult("1.0.0");
      if (opts.args.includes("auth")) return timedOutResult();
      return okResult("PONG");
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const r = check.getLastResult()?.results.find((x) => x.runtime === "claude-code");
    expect(r?.authCheck.ok).toBe(false);
    expect(r?.authCheck.error).toContain("Auth probe timed out after");
  });

  it("marks the auth check failed when processRunner.execute throws during the auth probe", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts) => {
      if (opts.args.includes("--version")) return okResult("1.0.0");
      if (opts.args.includes("auth")) throw new Error("socket hang up");
      return okResult("PONG");
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const r = check.getLastResult()?.results.find((x) => x.runtime === "claude-code");
    expect(r?.authCheck.ok).toBe(false);
    expect(r?.authCheck.error).toBe("socket hang up");
  });

  it("supports the exitCodeOnly auth strategy (passes on exit 0 regardless of output)", async () => {
    const configs = makeConfigs();
    // Drive the exitCodeOnly branch through a required runtime by overriding its config.
    configs["codex"] = {
      command: "codex",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    };
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts) => {
      if (opts.args.includes("--version")) return okResult("1.0.0");
      if (opts.args.includes("auth")) return okResult('{"loggedIn": true}');
      if (opts.args.includes("status")) return okResult("irrelevant output");
      return okResult();
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });

  it("fails the exitCodeOnly auth strategy on a non-zero exit code", async () => {
    const configs = makeConfigs();
    configs["codex"] = {
      command: "codex",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    };
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts) => {
      if (opts.args.includes("--version")) return okResult("1.0.0");
      if (opts.args.includes("auth")) return okResult('{"loggedIn": true}');
      if (opts.args.includes("status")) return failResult(2, "unauthorized");
      return okResult();
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const r = check.getLastResult()?.results.find((x) => x.runtime === "codex");
    expect(r?.authCheck.ok).toBe(false);
    expect(r?.authCheck.error).toContain("Exit code 2");
  });

  it("passes the default pong-probe strategy even on a non-zero exit code, as long as output contains pong", async () => {
    const configs = makeConfigs();
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts) => {
      if (opts.args.includes("--version")) return okResult("1.0.0");
      if (opts.args.includes("auth")) return okResult('{"loggedIn": true}');
      // codex probe: non-zero exit, but stdout contains "pong" -> still ok.
      return failResult(3, "PONG anyway");
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
    const codexResult = result.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(true);
  });

  it("fails the default pong-probe strategy when output lacks pong, reporting the exit-code error form", async () => {
    const configs = makeConfigs();
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts) => {
      if (opts.args.includes("--version")) return okResult("1.0.0");
      if (opts.args.includes("auth")) return okResult('{"loggedIn": true}');
      return failResult(1, "no idea what happened");
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const r = check.getLastResult()?.results.find((x) => x.runtime === "codex");
    expect(r?.authCheck.ok).toBe(false);
    expect(r?.authCheck.error).toContain("Exit code 1");
  });

  it("fails the default pong-probe strategy when exit code is 0 but output still lacks pong", async () => {
    const configs = makeConfigs();
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts) => {
      if (opts.args.includes("--version")) return okResult("1.0.0");
      if (opts.args.includes("auth")) return okResult('{"loggedIn": true}');
      return okResult("nothing useful here");
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const r = check.getLastResult()?.results.find((x) => x.runtime === "codex");
    expect(r?.authCheck.ok).toBe(false);
    expect(r?.authCheck.error).toContain("did not return expected response");
  });

  it("passes stdinData from the config through to the auth probe call", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts) => {
      if (opts.args.includes("--version")) return okResult("1.0.0");
      if (opts.args.includes("auth")) return okResult('{"loggedIn": true}');
      return okResult("PONG");
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, makeConfigs(), logger as never);

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

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds the expected static shape for each runtime", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--base"],
      "codex",
      ["exec", "-"],
      "agent",
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
      command: "agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});
