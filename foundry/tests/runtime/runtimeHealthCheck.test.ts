import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeProcessRunner() {
  return { execute: vi.fn() };
}

function okResult(stdout = "", stderr = "", exitCode = 0): ProcessResult {
  return { stdout, stderr, exitCode, durationMs: 5, timedOut: false };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds configs for claude-code, codex and cursor with their respective probe strategies", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--base"],
      "codex",
      ["exec", "-"],
      "cursor-agent",
    );

    expect(configs["claude-code"].command).toBe("claude");
    expect(configs["claude-code"].probeArgs).toEqual(["auth", "status"]);
    expect(configs["claude-code"].successPattern).toBeDefined();

    expect(configs.codex.command).toBe("codex");
    expect(configs.codex.probeArgs).toEqual(["exec", "-"]);
    expect(configs.codex.probeStdin).toBe("Respond with exactly: PONG");

    expect(configs.cursor.command).toBe("cursor-agent");
    expect(configs.cursor.probeArgs).toEqual(["status"]);
    expect(configs.cursor.exitCodeOnly).toBe(true);
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes", () => {
  it("returns the distinct set of runtimes used by AGENT_STAGES (claude-code and codex, not cursor)", () => {
    const check = new RuntimeHealthCheck(
      makeProcessRunner() as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec"], "cursor-agent"),
      makeLogger() as never,
    );

    const required = check.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });
});

describe("RuntimeHealthCheck.getLastResult", () => {
  it("returns undefined before runPreflight has ever run", () => {
    const check = new RuntimeHealthCheck(
      makeProcessRunner() as never,
      RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec"], "cursor-agent"),
      makeLogger() as never,
    );
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight", () => {
  let processRunner: ReturnType<typeof makeProcessRunner>;
  let configs: ReturnType<typeof RuntimeHealthCheck.buildRuntimeConfigs>;

  beforeEach(() => {
    processRunner = makeProcessRunner();
    configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      [],
      "codex",
      ["exec", "-"],
      "cursor-agent",
    );
  });

  it("resolves ok:true and caches the result via getLastResult when all required runtimes pass", async () => {
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return okResult("v1.2.3\n");
      if (opts.args.includes("auth")) return okResult('{"loggedIn": true}');
      // codex auth probe (stdin PONG style)
      return okResult("PONG");
    });

    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);
    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"].sort());
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(check.getLastResult()).toBe(result);
  });

  it("throws PreflightError (carrying the failing result) when the binary check fails", async () => {
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args.includes("--version")) {
        return okResult("", "command not found", 127);
      }
      if (opts.args.includes("--version")) return okResult("v1.0.0");
      return okResult("PONG");
    });

    const logger = makeLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([expect.objectContaining({ runtime: "claude-code" })]),
      }),
      expect.stringContaining("Preflight FAILED"),
    );

    const lastResult = check.getLastResult();
    expect(lastResult?.ok).toBe(false);
  });

  it("skips the auth probe and marks authCheck failed when the binary check itself fails", async () => {
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude") return okResult("", "ENOENT", 127);
      if (opts.args.includes("--version")) return okResult("v1.0.0");
      return okResult("PONG");
    });

    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const result = check.getLastResult();
    const claudeResult = result?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("Skipped");
    // Only the --version call should have happened for claude (no auth probe call)
    const claudeCalls = processRunner.execute.mock.calls.filter(
      (c) => (c[0] as { command: string }).command === "claude",
    );
    expect(claudeCalls).toHaveLength(1);
  });

  it("fails the auth check when the success pattern does not match stdout", async () => {
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args.includes("--version")) return okResult("v1.0.0");
      if (opts.command === "claude") return okResult('{"loggedIn": false}');
      if (opts.args.includes("--version")) return okResult("v1.0.0");
      return okResult("PONG");
    });

    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("expected pattern not found");
  });

  it("fails the auth check for codex when neither exit code 0 nor a PONG response is present", async () => {
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args.includes("--version")) return okResult("v1.0.0");
      if (opts.command === "claude") return okResult('{"loggedIn": true}');
      if (opts.command === "codex" && opts.args.includes("--version")) return okResult("v2.0.0");
      return okResult("not the expected text", "boom", 1);
    });

    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("Exit code 1");
  });

  it("passes the codex auth check on exit code 0 with a PONG response even without matching exitCodeOnly/successPattern", async () => {
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args.includes("--version")) return okResult("v1.0.0");
      if (opts.command === "claude") return okResult('{"loggedIn": true}');
      if (opts.command === "codex" && opts.args.includes("--version")) return okResult("v2.0.0");
      return okResult("some preamble PONG trailing", "", 0);
    });

    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);
    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });

  it("treats a timed-out binary check as a failure with a descriptive error", async () => {
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args.includes("--version")) {
        return { stdout: "", stderr: "", exitCode: 1, durationMs: 5000, timedOut: true };
      }
      if (opts.args.includes("--version")) return okResult("v2.0.0");
      return okResult("PONG");
    });

    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toContain("Timed out");
  });

  it("treats a timed-out auth probe as a failure with a descriptive error", async () => {
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return okResult("v1.0.0");
      if (opts.command === "claude") {
        return { stdout: "", stderr: "", exitCode: 1, durationMs: 30000, timedOut: true };
      }
      return okResult("PONG");
    });

    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("Auth probe timed out");
  });

  it("catches a thrown error from processRunner.execute during the binary check and reports it as a failure", async () => {
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args.includes("--version")) {
        throw new Error("spawn ENOENT");
      }
      if (opts.args.includes("--version")) return okResult("v2.0.0");
      return okResult("PONG");
    });

    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toBe("spawn ENOENT");
  });

  it("catches a thrown error from processRunner.execute during the auth check and reports it as a failure", async () => {
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return okResult("v1.0.0");
      if (opts.command === "claude") throw new Error("auth probe crashed");
      return okResult("PONG");
    });

    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toBe("auth probe crashed");
  });

  it("exercises the exitCodeOnly auth-check branch (as used by the cursor runtime config) for a required runtime", async () => {
    // getRequiredRuntimes() only returns runtimes actually used by AGENT_STAGES
    // (claude-code, codex), so to exercise the exitCodeOnly branch of
    // checkAuth (normally only reached by the cursor config) we substitute an
    // exitCodeOnly config onto a runtime slot that IS required.
    const exitCodeOnlyConfigs = {
      ...configs,
      "claude-code": {
        command: "claude",
        versionArgs: ["--version"],
        probeArgs: ["status"],
        exitCodeOnly: true,
      },
    };

    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args.includes("--version")) return okResult("v1.0.0");
      if (opts.command === "claude") return okResult("", "", 0);
      if (opts.args.includes("--version")) return okResult("v2.0.0");
      return okResult("PONG");
    });

    const check = new RuntimeHealthCheck(
      processRunner as never,
      exitCodeOnlyConfigs,
      makeLogger() as never,
    );
    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });

  it("fails the exitCodeOnly auth check when the probe exits non-zero", async () => {
    const exitCodeOnlyConfigs = {
      ...configs,
      "claude-code": {
        command: "claude",
        versionArgs: ["--version"],
        probeArgs: ["status"],
        exitCodeOnly: true,
      },
    };

    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args.includes("--version")) return okResult("v1.0.0");
      if (opts.command === "claude") return okResult("", "not logged in", 3);
      if (opts.args.includes("--version")) return okResult("v2.0.0");
      return okResult("PONG");
    });

    const check = new RuntimeHealthCheck(
      processRunner as never,
      exitCodeOnlyConfigs,
      makeLogger() as never,
    );
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.error).toContain("Exit code 3");
  });

  it("logs a success message with totalDurationMs and the required runtimes when ok", async () => {
    processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return okResult("v1.0.0");
      if (opts.args.includes("auth")) return okResult('{"loggedIn": true}');
      return okResult("PONG");
    });

    const logger = makeLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    await check.runPreflight();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtimes: expect.any(Array) }),
      expect.stringContaining("Preflight passed"),
    );
  });
});
