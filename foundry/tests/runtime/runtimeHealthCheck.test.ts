import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeProcessRunner() {
  return { execute: vi.fn() };
}

function result(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 5,
    timedOut: false,
    ...overrides,
  };
}

const CLAUDE_CONFIG = {
  command: "claude",
  versionArgs: ["--version"],
  probeArgs: ["auth", "status"],
  successPattern: '"loggedIn":\\s*true',
};

const CODEX_CONFIG = {
  command: "codex",
  versionArgs: ["--version"],
  probeArgs: ["exec", "-"],
  probeStdin: "Respond with exactly: PONG",
};

const CURSOR_CONFIG = {
  command: "cursor",
  versionArgs: ["--version"],
  probeArgs: ["status"],
  exitCodeOnly: true,
};

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds the expected per-runtime probe configuration", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");

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
      command: "cursor",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes / getLastResult", () => {
  it("derives the required runtime set from AGENT_STAGES (claude-code and codex, not cursor)", () => {
    const check = new RuntimeHealthCheck(
      makeProcessRunner() as never,
      {
        "claude-code": CLAUDE_CONFIG,
        codex: CODEX_CONFIG,
        cursor: CURSOR_CONFIG,
      },
      makeLogger() as never,
    );

    const required = check.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
  });

  it("returns undefined for getLastResult before any preflight has run", () => {
    const check = new RuntimeHealthCheck(
      makeProcessRunner() as never,
      { "claude-code": CLAUDE_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      makeLogger() as never,
    );
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight — success", () => {
  it("passes and caches the result when every required runtime's binary+auth checks succeed", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) {
        return result({ stdout: `${command} v1.2.3\n` });
      }
      if (command === "claude") {
        return result({ stdout: '{"loggedIn": true}' });
      }
      if (command === "codex") {
        return result({ stdout: "PONG" });
      }
      return result({ exitCode: 0 });
    });
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": CLAUDE_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      logger as never,
    );

    const preflight = await check.runPreflight();

    expect(preflight.ok).toBe(true);
    expect(preflight.requiredRuntimes.sort()).toEqual(["claude-code", "codex"].sort());
    expect(preflight.skippedRuntimes).toContain("cursor");
    expect(preflight.results).toHaveLength(2);
    expect(check.getLastResult()).toBe(preflight);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("captures the first line of version output, truncated to 100 chars", async () => {
    const processRunner = makeProcessRunner();
    const longVersion = "v" + "9".repeat(150);
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) {
        return result({ stdout: `${longVersion}\nextra line\n` });
      }
      if (command === "claude") return result({ stdout: '{"loggedIn": true}' });
      return result({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": CLAUDE_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      makeLogger() as never,
    );

    const preflight = await check.runPreflight();
    const claudeResult = preflight.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.version!.length).toBeLessThanOrEqual(100);
    expect(claudeResult.binaryCheck.version).toBe(longVersion.slice(0, 100));
  });
});

describe("RuntimeHealthCheck.runPreflight — binary check failures", () => {
  it("throws PreflightError and skips the auth check when the version probe times out", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockResolvedValue(result({ timedOut: true }));
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": CLAUDE_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      logger as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    // Every failure skips its auth probe: exactly one execute() call per runtime (version only).
    expect(processRunner.execute).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("marks the binary check failed with a stderr snippet on non-zero exit", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async ({ args }) => {
      if (args.includes("--version")) {
        return result({ exitCode: 127, stderr: "command not found: claude" });
      }
      return result();
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": CLAUDE_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      makeLogger() as never,
    );

    try {
      await check.runPreflight();
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightError);
      const claudeResult = (err as PreflightError).result.results.find(
        (r) => r.runtime === "claude-code",
      )!;
      expect(claudeResult.binaryCheck.ok).toBe(false);
      expect(claudeResult.binaryCheck.error).toContain("Exit code 127");
      expect(claudeResult.binaryCheck.error).toContain("command not found: claude");
      expect(claudeResult.authCheck.ok).toBe(false);
      expect(claudeResult.authCheck.error).toBe("Skipped: binary check failed");
    }
  });

  it("marks the binary check failed when the process throws", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async ({ args }) => {
      if (args.includes("--version")) {
        throw new Error("spawn ENOENT");
      }
      return result();
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": CLAUDE_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      makeLogger() as never,
    );

    try {
      await check.runPreflight();
      expect.unreachable();
    } catch (err) {
      const claudeResult = (err as PreflightError).result.results.find(
        (r) => r.runtime === "claude-code",
      )!;
      expect(claudeResult.binaryCheck.ok).toBe(false);
      expect(claudeResult.binaryCheck.error).toBe("spawn ENOENT");
    }
  });

  it("stringifies a non-Error thrown value from the binary check", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async ({ args }) => {
      if (args.includes("--version")) {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "raw string failure";
      }
      return result();
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": CLAUDE_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      makeLogger() as never,
    );

    try {
      await check.runPreflight();
      expect.unreachable();
    } catch (err) {
      const claudeResult = (err as PreflightError).result.results.find(
        (r) => r.runtime === "claude-code",
      )!;
      expect(claudeResult.binaryCheck.error).toBe("raw string failure");
    }
  });
});

describe("RuntimeHealthCheck.runPreflight — auth check paths", () => {
  it("fails auth via successPattern when the pattern does not match stdout/stderr", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return result({ stdout: "v1" });
      if (command === "claude") return result({ stdout: '{"loggedIn": false}' });
      return result({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": CLAUDE_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      makeLogger() as never,
    );

    try {
      await check.runPreflight();
      expect.unreachable();
    } catch (err) {
      const claudeResult = (err as PreflightError).result.results.find(
        (r) => r.runtime === "claude-code",
      )!;
      expect(claudeResult.authCheck.ok).toBe(false);
      expect(claudeResult.authCheck.error).toContain("expected pattern not found");
    }
  });

  it("passes auth via successPattern when it matches stderr instead of stdout", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return result({ stdout: "v1" });
      if (command === "claude") return result({ stderr: '{"loggedIn": true}' });
      return result({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": CLAUDE_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      makeLogger() as never,
    );

    const preflight = await check.runPreflight();
    const claudeResult = preflight.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(true);
  });

  it("times out the auth probe distinctly from the binary check timeout", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return result({ stdout: "v1" });
      if (command === "claude") return result({ timedOut: true });
      return result({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": CLAUDE_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      makeLogger() as never,
    );

    try {
      await check.runPreflight();
      expect.unreachable();
    } catch (err) {
      const claudeResult = (err as PreflightError).result.results.find(
        (r) => r.runtime === "claude-code",
      )!;
      expect(claudeResult.authCheck.ok).toBe(false);
      expect(claudeResult.authCheck.error).toContain("Auth probe timed out");
    }
  });

  it("passes exitCodeOnly auth checks on exit code 0 regardless of output", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return result({ stdout: "v1" });
      if (command === "claude") return result({ stdout: '{"loggedIn": true}' });
      if (command === "cursor") return result({ exitCode: 0, stdout: "" });
      return result({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      // Force cursor into the required set for this test by making it the only stage-mapped runtime.
      { "claude-code": CURSOR_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      makeLogger() as never,
    );

    const preflight = await check.runPreflight();
    expect(preflight.ok).toBe(true);
  });

  it("fails exitCodeOnly auth checks with a stderr/stdout snippet on non-zero exit", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async ({ args }) => {
      if (args.includes("--version")) return result({ stdout: "v1" });
      return result({ exitCode: 1, stderr: "not logged in" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": CURSOR_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      makeLogger() as never,
    );

    try {
      await check.runPreflight();
      expect.unreachable();
    } catch (err) {
      const r = (err as PreflightError).result.results.find((x) => x.runtime === "claude-code")!;
      expect(r.authCheck.ok).toBe(false);
      expect(r.authCheck.error).toContain("Exit code 1");
      expect(r.authCheck.error).toContain("not logged in");
    }
  });

  it("falls back to stdout in the exitCodeOnly error message when stderr is empty", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async ({ args }) => {
      if (args.includes("--version")) return result({ stdout: "v1" });
      return result({ exitCode: 1, stderr: "", stdout: "cursor: not authenticated" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": CURSOR_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      makeLogger() as never,
    );

    try {
      await check.runPreflight();
      expect.unreachable();
    } catch (err) {
      const r = (err as PreflightError).result.results.find((x) => x.runtime === "claude-code")!;
      expect(r.authCheck.error).toContain("cursor: not authenticated");
    }
  });

  it("stringifies a non-Error thrown value from the auth check", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return result({ stdout: "v1" });
      if (command === "claude") {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "raw auth failure";
      }
      return result({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": CLAUDE_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      makeLogger() as never,
    );

    try {
      await check.runPreflight();
      expect.unreachable();
    } catch (err) {
      const claudeResult = (err as PreflightError).result.results.find(
        (r) => r.runtime === "claude-code",
      )!;
      expect(claudeResult.authCheck.error).toBe("raw auth failure");
    }
  });

  it("passes the PONG-style check when exit code is non-zero but output still contains pong", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return result({ stdout: "v1" });
      if (command === "codex") return result({ exitCode: 1, stdout: "warning\nPONG" });
      return result({ stdout: '{"loggedIn": true}' });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": CLAUDE_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      makeLogger() as never,
    );

    const preflight = await check.runPreflight();
    const codexResult = preflight.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(true);
  });

  it("fails the PONG-style check on non-zero exit with no pong in the output", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return result({ stdout: "v1" });
      if (command === "codex") return result({ exitCode: 1, stderr: "auth expired" });
      return result({ stdout: '{"loggedIn": true}' });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": CLAUDE_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      makeLogger() as never,
    );

    try {
      await check.runPreflight();
      expect.unreachable();
    } catch (err) {
      const codexResult = (err as PreflightError).result.results.find((r) => r.runtime === "codex")!;
      expect(codexResult.authCheck.ok).toBe(false);
      expect(codexResult.authCheck.error).toContain("Exit code 1");
      expect(codexResult.authCheck.error).toContain("auth expired");
    }
  });

  it("fails the PONG-style check on exit code 0 with no pong in the output", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return result({ stdout: "v1" });
      if (command === "codex") return result({ exitCode: 0, stdout: "I am not sure how to respond." });
      return result({ stdout: '{"loggedIn": true}' });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": CLAUDE_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      makeLogger() as never,
    );

    try {
      await check.runPreflight();
      expect.unreachable();
    } catch (err) {
      const codexResult = (err as PreflightError).result.results.find((r) => r.runtime === "codex")!;
      expect(codexResult.authCheck.ok).toBe(false);
      expect(codexResult.authCheck.error).toContain("did not return expected response");
    }
  });

  it("marks the auth check failed when the process throws", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return result({ stdout: "v1" });
      if (command === "claude") throw new Error("stdin write failed");
      return result({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": CLAUDE_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      makeLogger() as never,
    );

    try {
      await check.runPreflight();
      expect.unreachable();
    } catch (err) {
      const claudeResult = (err as PreflightError).result.results.find(
        (r) => r.runtime === "claude-code",
      )!;
      expect(claudeResult.authCheck.ok).toBe(false);
      expect(claudeResult.authCheck.error).toBe("stdin write failed");
    }
  });

  it("passes probeStdin through to the auth-check execute() call", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return result({ stdout: "v1" });
      if (command === "claude") return result({ stdout: '{"loggedIn": true}' });
      return result({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": CLAUDE_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      makeLogger() as never,
    );

    await check.runPreflight();

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "codex",
        args: CODEX_CONFIG.probeArgs,
        stdinData: "Respond with exactly: PONG",
      }),
    );
  });
});

describe("RuntimeHealthCheck.runPreflight — logging on partial failure", () => {
  it("logs only the failing runtimes' errors when one of several runtimes fails", async () => {
    const processRunner = makeProcessRunner();
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return result({ stdout: "v1" });
      if (command === "claude") return result({ stdout: '{"loggedIn": true}' });
      if (command === "codex") return result({ exitCode: 1, stdout: "connection refused" });
      return result({ stdout: "PONG" });
    });
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(
      processRunner as never,
      { "claude-code": CLAUDE_CONFIG, codex: CODEX_CONFIG, cursor: CURSOR_CONFIG },
      logger as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const [logFields] = logger.error.mock.calls.find(
      ([, msg]) => msg === "Preflight FAILED: one or more agent runtimes are not ready",
    )!;
    expect(logFields.failures).toHaveLength(1);
    expect(logFields.failures[0]).toMatchObject({ runtime: "codex", binaryError: undefined });
    expect(logFields.failures[0].authError).toContain("Exit code 1");
  });
});
