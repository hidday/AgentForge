import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function okResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 10, timedOut: false, ...overrides };
}

const configs = RuntimeHealthCheck.buildRuntimeConfigs(
  "claude",
  ["--print"],
  "codex",
  ["exec", "-"],
  "agent",
);

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds a claude-code config with an auth-status success pattern", () => {
    expect(configs["claude-code"]).toMatchObject({
      command: "claude",
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });
  });

  it("builds a codex config that echoes PONG via stdin", () => {
    expect(configs.codex).toMatchObject({
      command: "codex",
      versionArgs: ["--version"],
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });
  });

  it("builds a cursor config that only checks the exit code", () => {
    expect(configs.cursor).toMatchObject({
      command: "agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes / getLastResult", () => {
  it("derives required runtimes from AGENT_STAGES (claude-code and codex; cursor unused)", () => {
    const processRunner = { execute: vi.fn() };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
    const required = check.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });

  it("returns undefined from getLastResult before any preflight has run", () => {
    const processRunner = { execute: vi.fn() };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight — success path", () => {
  it("resolves ok:true when every required runtime's binary and auth checks pass, and records lastResult", async () => {
    const processRunner = {
      execute: vi.fn(async (opts: { command: string; args: string[]; stdinData?: string }) => {
        if (opts.args.includes("--version")) {
          return okResult({ stdout: "1.2.3\n" });
        }
        if (opts.command === "claude") {
          return okResult({ stdout: '{"loggedIn": true}' });
        }
        if (opts.command === "codex") {
          return okResult({ stdout: "PONG" });
        }
        return okResult();
      }),
    };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"].sort());
    expect(result.skippedRuntimes).toEqual(["cursor"]);
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
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("RuntimeHealthCheck.runPreflight — failure paths", () => {
  it("throws PreflightError and skips the auth check when the binary check fails", async () => {
    const processRunner = {
      execute: vi.fn(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return okResult({ exitCode: 127, stderr: "command not found", stdout: "" });
        }
        return okResult();
      }),
    };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    // executed again to inspect the thrown error's payload
    const err = await check.runPreflight().catch((e) => e as PreflightError);
    expect(err).toBeInstanceOf(PreflightError);
    expect(err.result.ok).toBe(false);
    for (const r of err.result.results) {
      expect(r.binaryCheck.ok).toBe(false);
      expect(r.binaryCheck.error).toContain("Exit code 127");
      expect(r.authCheck.ok).toBe(false);
      expect(r.authCheck.error).toBe("Skipped: binary check failed");
    }
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ binaryError: expect.stringContaining("Exit code 127") }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("reports a timed-out binary check distinctly from an exit-code failure", async () => {
    const processRunner = {
      execute: vi.fn(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return okResult({ timedOut: true });
        }
        return okResult();
      }),
    };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      configs,
      makeMockLogger() as never,
    );

    const err = await check.runPreflight().catch((e) => e as PreflightError);
    expect(err).toBeInstanceOf(PreflightError);
    const claudeResult = err.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.error).toBe("Timed out after 5000ms");
  });

  it("catches a thrown process error during the binary check and surfaces its message", async () => {
    const processRunner = {
      execute: vi.fn(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          throw new Error("spawn ENOENT");
        }
        return okResult();
      }),
    };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      configs,
      makeMockLogger() as never,
    );

    const err = await check.runPreflight().catch((e) => e as PreflightError);
    expect(err).toBeInstanceOf(PreflightError);
    for (const r of err.result.results) {
      expect(r.binaryCheck.ok).toBe(false);
      expect(r.binaryCheck.error).toBe("spawn ENOENT");
    }
  });

  it("catches a non-Error throw during the binary check and stringifies it", async () => {
    const processRunner = {
      execute: vi.fn(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw "raw string failure";
        }
        return okResult();
      }),
    };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      configs,
      makeMockLogger() as never,
    );

    const err = await check.runPreflight().catch((e) => e as PreflightError);
    const claudeResult = err.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.error).toBe("raw string failure");
  });
});

describe("RuntimeHealthCheck auth-check pattern matching (via runPreflight)", () => {
  it("fails the successPattern auth check when the pattern does not match, including a stdout snippet", async () => {
    const processRunner = {
      execute: vi.fn(async (opts: { command: string; args: string[] }) => {
        if (opts.args.includes("--version")) return okResult({ stdout: "1.0.0" });
        if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": false}' });
        return okResult({ stdout: "PONG" });
      }),
    };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      configs,
      makeMockLogger() as never,
    );

    const err = await check.runPreflight().catch((e) => e as PreflightError);
    const claudeResult = err.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toContain("expected pattern not found");
    expect(claudeResult.authCheck.error).toContain("loggedIn");
  });

  it("times out the auth probe distinctly from a pattern mismatch", async () => {
    const processRunner = {
      execute: vi.fn(async (opts: { command: string; args: string[] }) => {
        if (opts.args.includes("--version")) return okResult({ stdout: "1.0.0" });
        if (opts.command === "claude") return okResult({ timedOut: true });
        return okResult({ stdout: "PONG" });
      }),
    };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      configs,
      makeMockLogger() as never,
    );

    const err = await check.runPreflight().catch((e) => e as PreflightError);
    const claudeResult = err.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.error).toBe("Auth probe timed out after 30000ms");
  });

  it("fails an exitCodeOnly-style auth check on non-zero exit (via a synthetic cursor-shaped required set)", async () => {
    // cursor isn't a required runtime in real AGENT_STAGES, so exercise the
    // exitCodeOnly branch directly through probeRuntime-equivalent behavior
    // by constructing a health check whose configs point every required
    // runtime at the cursor-style (exitCodeOnly) auth config.
    const cursorLikeConfigs = {
      "claude-code": configs.cursor,
      codex: configs.cursor,
      cursor: configs.cursor,
    };
    const processRunner = {
      execute: vi.fn(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) return okResult({ stdout: "1.0.0" });
        return okResult({ exitCode: 3, stderr: "not logged in" });
      }),
    };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      cursorLikeConfigs as never,
      makeMockLogger() as never,
    );

    const err = await check.runPreflight().catch((e) => e as PreflightError);
    for (const r of err.result.results) {
      expect(r.authCheck.ok).toBe(false);
      expect(r.authCheck.error).toContain("Exit code 3");
      expect(r.authCheck.error).toContain("not logged in");
    }
  });

  it("passes an exitCodeOnly-style auth check on exit code 0", async () => {
    const cursorLikeConfigs = {
      "claude-code": configs.cursor,
      codex: configs.cursor,
      cursor: configs.cursor,
    };
    const processRunner = {
      execute: vi.fn(async () => okResult({ stdout: "1.0.0" })),
    };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      cursorLikeConfigs as never,
      makeMockLogger() as never,
    );

    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });

  it("passes the default (pong) auth check even on non-zero exit as long as PONG is present", async () => {
    const codexLikeConfigs = {
      "claude-code": configs.codex,
      codex: configs.codex,
      cursor: configs.codex,
    };
    const processRunner = {
      execute: vi.fn(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) return okResult({ stdout: "1.0.0" });
        return okResult({ exitCode: 1, stdout: "pong", stderr: "warning: deprecated" });
      }),
    };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      codexLikeConfigs as never,
      makeMockLogger() as never,
    );

    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });

  it("fails the default (pong) auth check on non-zero exit with no PONG in output", async () => {
    const codexLikeConfigs = {
      "claude-code": configs.codex,
      codex: configs.codex,
      cursor: configs.codex,
    };
    const processRunner = {
      execute: vi.fn(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) return okResult({ stdout: "1.0.0" });
        return okResult({ exitCode: 1, stdout: "", stderr: "connection refused" });
      }),
    };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      codexLikeConfigs as never,
      makeMockLogger() as never,
    );

    const err = await check.runPreflight().catch((e) => e as PreflightError);
    for (const r of err.result.results) {
      expect(r.authCheck.ok).toBe(false);
      expect(r.authCheck.error).toContain("Exit code 1");
      expect(r.authCheck.error).toContain("connection refused");
    }
  });

  it("fails the default (pong) auth check on exit code 0 with no PONG in output", async () => {
    const codexLikeConfigs = {
      "claude-code": configs.codex,
      codex: configs.codex,
      cursor: configs.codex,
    };
    const processRunner = {
      execute: vi.fn(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) return okResult({ stdout: "1.0.0" });
        return okResult({ exitCode: 0, stdout: "no response recognized" });
      }),
    };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      codexLikeConfigs as never,
      makeMockLogger() as never,
    );

    const err = await check.runPreflight().catch((e) => e as PreflightError);
    for (const r of err.result.results) {
      expect(r.authCheck.ok).toBe(false);
      expect(r.authCheck.error).toContain("Auth probe did not return expected response");
    }
  });

  it("catches a thrown process error during the auth check and surfaces its message", async () => {
    const processRunner = {
      execute: vi.fn(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) return okResult({ stdout: "1.0.0" });
        throw new Error("stdin write EPIPE");
      }),
    };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      configs,
      makeMockLogger() as never,
    );

    const err = await check.runPreflight().catch((e) => e as PreflightError);
    for (const r of err.result.results) {
      expect(r.authCheck.ok).toBe(false);
      expect(r.authCheck.error).toBe("stdin write EPIPE");
    }
  });

  it("truncates the version string to its first line and 100 characters", async () => {
    const longVersion = `v${"9".repeat(150)}\nextra line ignored`;
    const processRunner = {
      execute: vi.fn(async (opts: { command: string; args: string[] }) => {
        if (opts.args.includes("--version")) return okResult({ stdout: longVersion });
        if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
        return okResult({ stdout: "PONG" });
      }),
    };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      configs,
      makeMockLogger() as never,
    );

    const result = await check.runPreflight();
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.version).toHaveLength(100);
    expect(claudeResult.binaryCheck.version).not.toContain("\n");
  });
});
