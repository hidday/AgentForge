import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeMockProcessRunner() {
  return { execute: vi.fn() };
}

function okResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 10, timedOut: false, ...overrides };
}

const configs = RuntimeHealthCheck.buildRuntimeConfigs(
  "claude",
  ["--print"],
  "codex",
  ["exec", "-"],
  "cursor-agent",
);

describe("RuntimeHealthCheck.buildRuntimeConfigs()", () => {
  it("builds the claude-code config with an auth-status success pattern", () => {
    expect(configs["claude-code"]).toMatchObject({
      command: "claude",
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });
  });

  it("builds the codex config with a PONG stdin probe and the given base args", () => {
    expect(configs.codex).toMatchObject({
      command: "codex",
      versionArgs: ["--version"],
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });
  });

  it("builds the cursor config as an exit-code-only probe", () => {
    expect(configs.cursor).toMatchObject({
      command: "cursor-agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes() / getLastResult()", () => {
  it("returns the runtimes used by any configured agent stage (claude-code and codex, but not cursor)", () => {
    const check = new RuntimeHealthCheck(
      makeMockProcessRunner() as never,
      configs,
      makeMockLogger() as never,
    );
    const required = check.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });

  it("returns undefined before runPreflight() has ever completed", () => {
    const check = new RuntimeHealthCheck(
      makeMockProcessRunner() as never,
      configs,
      makeMockLogger() as never,
    );
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight()", () => {
  it("passes when both binary and auth checks succeed for every required runtime, and records skipped runtimes", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation((opts) => {
      if (opts.args[0] === "--version") {
        return Promise.resolve(okResult({ stdout: "1.2.3\n" }));
      }
      if (opts.args.includes("status")) {
        return Promise.resolve(okResult({ stdout: '{"loggedIn": true}' }));
      }
      // codex pong probe
      return Promise.resolve(okResult({ stdout: "PONG" }));
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

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

  it("throws PreflightError and logs failures when any runtime fails its checks", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation((opts) => {
      if (opts.command === "claude") {
        return Promise.resolve(okResult({ stdout: "1.0.0" }));
      }
      if (opts.command === "codex" && opts.args[0] === "--version") {
        return Promise.resolve(okResult({ exitCode: 1, stderr: "not found" }));
      }
      return Promise.resolve(okResult());
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([expect.objectContaining({ runtime: "codex" })]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
    // lastResult should still be set to the (failing) result even though we threw.
    expect(check.getLastResult()?.ok).toBe(false);
  });

  it("reports binaryError as undefined in the failure summary when only the auth check failed", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation((opts) => {
      if (opts.args[0] === "--version") {
        return Promise.resolve(okResult({ stdout: "1.0.0" }));
      }
      if (opts.command === "claude") {
        // claude-code's auth probe fails the successPattern match.
        return Promise.resolve(okResult({ stdout: '{"loggedIn": false}' }));
      }
      return Promise.resolve(okResult({ stdout: "PONG" }));
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: [
          expect.objectContaining({ runtime: "claude-code", binaryError: undefined }),
        ],
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("skips the auth check entirely when the binary check fails", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation((opts) => {
      if (opts.args[0] === "--version" && opts.command === "claude") {
        return Promise.reject(new Error("ENOENT: claude not found"));
      }
      return Promise.resolve(okResult({ stdout: '{"loggedIn": true}' }));
    });
    const check = new RuntimeHealthCheck(
      processRunner as never,
      configs,
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const last = check.getLastResult()!;
    const claudeResult = last.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.ok).toBe(false);
    expect(claudeResult.authCheck).toEqual({
      ok: false,
      durationMs: 0,
      error: "Skipped: binary check failed",
    });
    // Only one call for claude-code: the version probe. The auth probe (args ["auth","status"]) never runs.
    const claudeCalls = processRunner.execute.mock.calls.filter(
      (c) => (c[0] as { command: string }).command === "claude",
    );
    expect(claudeCalls).toHaveLength(1);
  });
});

// checkBinary()/checkAuth() are private, but their branching depends only on
// the ProcessResult shape returned by the injected ProcessRunner, not on
// which runtimes AGENT_STAGES happens to require — so we invoke them
// directly rather than contorting a full runPreflight() around them.
interface PrivateMethods {
  checkBinary(config: (typeof configs)["claude-code"]): Promise<{
    ok: boolean;
    version?: string;
    error?: string;
    durationMs: number;
  }>;
  checkAuth(
    config: (typeof configs)["claude-code"],
  ): Promise<{ ok: boolean; durationMs: number; error?: string }>;
}

function asPrivate(check: RuntimeHealthCheck): PrivateMethods {
  return check as unknown as PrivateMethods;
}

describe("RuntimeHealthCheck — checkBinary() behavior", () => {
  it("marks ok with a trimmed, single-line version string", async () => {
    const execute = vi.fn().mockResolvedValue(okResult({ stdout: "  v1.2.3 \nextra line\n" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const binaryCheck = await asPrivate(check).checkBinary(configs["claude-code"]);
    expect(binaryCheck.ok).toBe(true);
    // .trim() only strips the leading/trailing ends of the whole string before
    // splitting on newlines, so an internal trailing space on the first line survives.
    expect(binaryCheck.version).toBe("v1.2.3 ");
  });

  it("marks not ok with a timeout message when the version probe times out", async () => {
    const execute = vi.fn().mockResolvedValue(okResult({ timedOut: true }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const binaryCheck = await asPrivate(check).checkBinary(configs["claude-code"]);
    expect(binaryCheck).toMatchObject({ ok: false, error: expect.stringContaining("Timed out after") });
  });

  it("marks not ok with exit-code/stderr detail on non-zero exit", async () => {
    const execute = vi.fn().mockResolvedValue(okResult({ exitCode: 127, stderr: "command not found" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const binaryCheck = await asPrivate(check).checkBinary(configs["claude-code"]);
    expect(binaryCheck).toMatchObject({ ok: false, error: "Exit code 127: command not found" });
  });

  it("marks not ok when execute() itself throws", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("spawn EACCES"));
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const binaryCheck = await asPrivate(check).checkBinary(configs["claude-code"]);
    expect(binaryCheck).toMatchObject({ ok: false, error: "spawn EACCES" });
  });

  it("marks not ok with a stringified error when a non-Error is thrown", async () => {
    const execute = vi.fn().mockRejectedValue("weird failure");
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const binaryCheck = await asPrivate(check).checkBinary(configs["claude-code"]);
    expect(binaryCheck).toMatchObject({ ok: false, error: "weird failure" });
  });
});

describe("RuntimeHealthCheck — checkAuth() behavior", () => {
  it("claude-code (successPattern): ok when the pattern matches the probe output", async () => {
    const execute = vi.fn().mockResolvedValue(okResult({ stdout: '{"loggedIn": true}' }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const authCheck = await asPrivate(check).checkAuth(configs["claude-code"]);
    expect(authCheck.ok).toBe(true);
  });

  it("claude-code (successPattern): not ok when the pattern does not match", async () => {
    const execute = vi.fn().mockResolvedValue(okResult({ stdout: '{"loggedIn": false}' }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const authCheck = await asPrivate(check).checkAuth(configs["claude-code"]);
    expect(authCheck).toMatchObject({
      ok: false,
      error: expect.stringContaining("expected pattern not found"),
    });
  });

  it("claude-code auth probe: not ok and reports timeout when it times out", async () => {
    const execute = vi.fn().mockResolvedValue(okResult({ timedOut: true }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const authCheck = await asPrivate(check).checkAuth(configs["claude-code"]);
    expect(authCheck).toMatchObject({
      ok: false,
      error: expect.stringContaining("Auth probe timed out after"),
    });
  });

  it("cursor (exitCodeOnly): ok on exit code 0 regardless of output content", async () => {
    const execute = vi.fn().mockResolvedValue(okResult({ exitCode: 0, stdout: "anything" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const authCheck = await asPrivate(check).checkAuth(configs.cursor);
    expect(authCheck.ok).toBe(true);
  });

  it("cursor (exitCodeOnly): not ok on non-zero exit code, falling back to stdout when stderr is empty", async () => {
    const execute = vi.fn().mockResolvedValue(okResult({ exitCode: 1, stderr: "", stdout: "not logged in" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const authCheck = await asPrivate(check).checkAuth(configs.cursor);
    expect(authCheck).toMatchObject({ ok: false, error: "Exit code 1: not logged in" });
  });

  it("codex (pong probe): ok when output contains PONG even if exit code is non-zero", async () => {
    const execute = vi.fn().mockResolvedValue(okResult({ exitCode: 1, stdout: "pong" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const authCheck = await asPrivate(check).checkAuth(configs.codex);
    expect(authCheck.ok).toBe(true);
  });

  it("codex (pong probe): not ok when exit code is non-zero and there is no pong", async () => {
    const execute = vi.fn().mockResolvedValue(okResult({ exitCode: 1, stderr: "connection refused" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const authCheck = await asPrivate(check).checkAuth(configs.codex);
    expect(authCheck).toMatchObject({ ok: false, error: "Exit code 1: connection refused" });
  });

  it("codex (pong probe): not ok when exit code is 0 but there is no pong in the output", async () => {
    const execute = vi.fn().mockResolvedValue(okResult({ exitCode: 0, stdout: "hello there" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const authCheck = await asPrivate(check).checkAuth(configs.codex);
    expect(authCheck).toMatchObject({
      ok: false,
      error: expect.stringContaining("did not return expected response"),
    });
  });

  it("marks authCheck not ok when execute() itself throws during the auth probe", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("socket hang up"));
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const authCheck = await asPrivate(check).checkAuth(configs.codex);
    expect(authCheck).toMatchObject({ ok: false, error: "socket hang up" });
  });

  it("marks authCheck not ok with a stringified error when a non-Error is thrown during the auth probe", async () => {
    const execute = vi.fn().mockRejectedValue("weird auth failure");
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    const authCheck = await asPrivate(check).checkAuth(configs.codex);
    expect(authCheck).toMatchObject({ ok: false, error: "weird auth failure" });
  });

  it("passes stdinData through to the auth probe for runtimes configured with probeStdin", async () => {
    const execute = vi.fn().mockResolvedValue(okResult({ stdout: "PONG" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);

    await asPrivate(check).checkAuth(configs.codex);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ stdinData: "Respond with exactly: PONG" }),
    );
  });
});
