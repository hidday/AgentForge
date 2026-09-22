import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function ok(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 5, timedOut: false, ...overrides };
}

const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds the expected per-runtime probe configuration", () => {
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
  it("derives the set of runtimes referenced by AGENT_STAGES", () => {
    const processRunner = { execute: vi.fn() };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
    const required = check.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
  });

  it("returns undefined before any preflight has run, then the last result after one runs", async () => {
    const processRunner = { execute: vi.fn().mockResolvedValue(ok({ stdout: "1.0.0" })) };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
    expect(check.getLastResult()).toBeUndefined();

    // claude-code auth check needs the successPattern to match; codex/cursor pass generically.
    processRunner.execute.mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return Promise.resolve(ok({ stdout: "1.0.0" }));
      if (opts.args.includes("auth")) {
        return Promise.resolve(ok({ stdout: '{"loggedIn": true}' }));
      }
      if (opts.args.includes("status")) return Promise.resolve(ok({ stdout: "ok" }));
      return Promise.resolve(ok({ stdout: "PONG" }));
    });

    const result = await check.runPreflight();
    expect(check.getLastResult()).toBe(result);
  });
});

describe("RuntimeHealthCheck.runPreflight", () => {
  it("passes when every required runtime's binary and auth checks succeed", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.args.includes("--version")) {
          return Promise.resolve(ok({ stdout: `${opts.command} v1.2.3` }));
        }
        if (opts.command === "claude") return Promise.resolve(ok({ stdout: '{"loggedIn":true}' }));
        if (opts.command === "codex") return Promise.resolve(ok({ stdout: "PONG" }));
        return Promise.resolve(ok({ stdout: "" }));
      }),
    };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"].sort());
    expect(result.skippedRuntimes).toContain("cursor");
    expect(result.results).toHaveLength(2);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("throws PreflightError and logs failures when a binary check fails", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.command === "claude" && opts.args.includes("--version")) {
          return Promise.resolve(ok({ exitCode: 127, stderr: "command not found" }));
        }
        if (opts.args.includes("--version")) return Promise.resolve(ok({ stdout: "v1" }));
        if (opts.command === "codex") return Promise.resolve(ok({ stdout: "PONG" }));
        return Promise.resolve(ok());
      }),
    };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);

    try {
      await check.runPreflight();
      expect.unreachable();
    } catch (err) {
      const e = err as PreflightError;
      expect(e.result.ok).toBe(false);
      const claudeResult = e.result.results.find((r) => r.runtime === "claude-code")!;
      expect(claudeResult.binaryCheck.ok).toBe(false);
      expect(claudeResult.binaryCheck.error).toContain("Exit code 127");
      // auth check is skipped entirely when the binary check fails
      expect(claudeResult.authCheck.ok).toBe(false);
      expect(claudeResult.authCheck.error).toBe("Skipped: binary check failed");
    }

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ runtime: "claude-code", binaryError: expect.any(String) }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("marks binaryCheck failed when the version probe times out", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.command === "claude" && opts.args.includes("--version")) {
          return Promise.resolve(ok({ timedOut: true }));
        }
        if (opts.args.includes("--version")) return Promise.resolve(ok({ stdout: "v1" }));
        if (opts.command === "codex") return Promise.resolve(ok({ stdout: "PONG" }));
        return Promise.resolve(ok());
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const result = check.getLastResult()!;
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.ok).toBe(false);
    expect(claudeResult.binaryCheck.error).toBe("Timed out after 5000ms");
  });

  it("marks binaryCheck failed when the version probe subprocess throws", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.command === "claude" && opts.args.includes("--version")) {
          return Promise.reject(new Error("ENOENT: spawn claude"));
        }
        if (opts.args.includes("--version")) return Promise.resolve(ok({ stdout: "v1" }));
        if (opts.command === "codex") return Promise.resolve(ok({ stdout: "PONG" }));
        return Promise.resolve(ok());
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const result = check.getLastResult()!;
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.ok).toBe(false);
    expect(claudeResult.binaryCheck.error).toBe("ENOENT: spawn claude");
  });

  it("truncates a long stderr in the binaryCheck error to 200 characters", async () => {
    const longStderr = "E".repeat(400);
    const processRunner = {
      execute: vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.command === "claude" && opts.args.includes("--version")) {
          return Promise.resolve(ok({ exitCode: 1, stderr: longStderr }));
        }
        if (opts.args.includes("--version")) return Promise.resolve(ok({ stdout: "v1" }));
        if (opts.command === "codex") return Promise.resolve(ok({ stdout: "PONG" }));
        return Promise.resolve(ok());
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const claudeResult = check.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.error).toContain(longStderr.slice(0, 200));
    expect(claudeResult.binaryCheck.error).not.toContain(longStderr.slice(0, 201));
  });

  it("captures the first line of stdout (truncated to 100 chars) as the version string", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.args.includes("--version")) {
          return Promise.resolve(ok({ stdout: "claude-cli 9.9.9\nextra ignored line\n" }));
        }
        if (opts.command === "claude") return Promise.resolve(ok({ stdout: '{"loggedIn":true}' }));
        return Promise.resolve(ok({ stdout: "PONG" }));
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
    const result = await check.runPreflight();
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.version).toBe("claude-cli 9.9.9");
  });

  it("fails the auth check when the auth probe times out", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.args.includes("--version")) return Promise.resolve(ok({ stdout: "v1" }));
        if (opts.command === "claude") return Promise.resolve(ok({ timedOut: true }));
        return Promise.resolve(ok({ stdout: "PONG" }));
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const claudeResult = check.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toBe("Auth probe timed out after 30000ms");
  });

  it("fails the auth check when successPattern does not match stdout or stderr", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.args.includes("--version")) return Promise.resolve(ok({ stdout: "v1" }));
        if (opts.command === "claude") return Promise.resolve(ok({ stdout: '{"loggedIn":false}' }));
        return Promise.resolve(ok({ stdout: "PONG" }));
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const claudeResult = check.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toContain("expected pattern not found in output");
  });

  it("passes the auth check via successPattern matched in stderr", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.args.includes("--version")) return Promise.resolve(ok({ stdout: "v1" }));
        if (opts.command === "claude") {
          return Promise.resolve(ok({ stdout: "", stderr: '{"loggedIn": true}' }));
        }
        return Promise.resolve(ok({ stdout: "PONG" }));
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
    const result = await check.runPreflight();
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(true);
  });

  it("fails the exitCodeOnly auth check (cursor) on non-zero exit, using stderr or stdout for the message", async () => {
    // Only claude-code and codex are "required" by AGENT_STAGES, so probe cursor directly
    // via a health check instance whose runtimeConfigs make cursor required by aliasing it.
    const processRunner = {
      execute: vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.args.includes("--version")) return Promise.resolve(ok({ stdout: "v1" }));
        return Promise.resolve(ok({ exitCode: 1, stderr: "not logged in" }));
      }),
    };
    const logger = makeMockLogger();
    // Force cursor to be treated as required by overriding getRequiredRuntimes via a
    // subclass-free trick: directly call the private probe path through runPreflight
    // isn't possible without cursor being required, so instead assert exitCodeOnly
    // behavior through the codex config path is not applicable. Use bracket access to
    // invoke the private probeRuntime for full branch coverage instead.
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    const probeRuntime = (check as unknown as {
      probeRuntime: (r: "cursor") => Promise<unknown>;
    }).probeRuntime.bind(check);

    const result = (await probeRuntime("cursor")) as {
      authCheck: { ok: boolean; error?: string };
    };
    expect(result.authCheck.ok).toBe(false);
    expect(result.authCheck.error).toContain("Exit code 1");
    expect(result.authCheck.error).toContain("not logged in");
  });

  it("falls back to stdout in the exitCodeOnly failure message when stderr is empty", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation((opts: { args: string[] }) => {
        if (opts.args.includes("--version")) return Promise.resolve(ok({ stdout: "v1" }));
        return Promise.resolve(ok({ exitCode: 2, stderr: "", stdout: "cursor: not authenticated" }));
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
    const probeRuntime = (check as unknown as {
      probeRuntime: (r: "cursor") => Promise<{ authCheck: { ok: boolean; error?: string } }>;
    }).probeRuntime.bind(check);

    const result = await probeRuntime("cursor");
    expect(result.authCheck.ok).toBe(false);
    expect(result.authCheck.error).toContain("cursor: not authenticated");
  });

  it("passes the exitCodeOnly auth check (cursor) on exit code 0", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation((opts: { args: string[] }) => {
        if (opts.args.includes("--version")) return Promise.resolve(ok({ stdout: "v1" }));
        return Promise.resolve(ok({ exitCode: 0 }));
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
    const probeRuntime = (check as unknown as {
      probeRuntime: (r: "cursor") => Promise<{ authCheck: { ok: boolean } }>;
    }).probeRuntime.bind(check);

    const result = await probeRuntime("cursor");
    expect(result.authCheck.ok).toBe(true);
  });

  it("fails the pong-style auth check (codex) on non-zero exit without a PONG in the output", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.args.includes("--version")) return Promise.resolve(ok({ stdout: "v1" }));
        if (opts.command === "claude") return Promise.resolve(ok({ stdout: '{"loggedIn":true}' }));
        return Promise.resolve(ok({ exitCode: 1, stderr: "rate limited" }));
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const codexResult = check.getLastResult()!.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(false);
    expect(codexResult.authCheck.error).toContain("Exit code 1");
    expect(codexResult.authCheck.error).toContain("rate limited");
  });

  it("fails the pong-style auth check (codex) on exit 0 with no PONG anywhere in the output", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.args.includes("--version")) return Promise.resolve(ok({ stdout: "v1" }));
        if (opts.command === "claude") return Promise.resolve(ok({ stdout: '{"loggedIn":true}' }));
        return Promise.resolve(ok({ stdout: "something else entirely" }));
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const codexResult = check.getLastResult()!.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(false);
    expect(codexResult.authCheck.error).toContain("did not return expected response");
  });

  it("passes the pong-style auth check (codex) when PONG appears despite a non-zero exit code", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.args.includes("--version")) return Promise.resolve(ok({ stdout: "v1" }));
        if (opts.command === "claude") return Promise.resolve(ok({ stdout: '{"loggedIn":true}' }));
        return Promise.resolve(ok({ exitCode: 3, stdout: "pong" }));
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
    const result = await check.runPreflight();
    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(true);
  });

  it("marks the auth check failed when the auth probe subprocess throws", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.args.includes("--version")) return Promise.resolve(ok({ stdout: "v1" }));
        if (opts.command === "claude") return Promise.reject(new Error("stdin write EPIPE"));
        return Promise.resolve(ok({ stdout: "PONG" }));
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const claudeResult = check.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toBe("stdin write EPIPE");
  });

  it("passes stdinData through to the auth probe when configured (codex PONG probe)", async () => {
    const processRunner = {
      execute: vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
        if (opts.args.includes("--version")) return Promise.resolve(ok({ stdout: "v1" }));
        if (opts.command === "claude") return Promise.resolve(ok({ stdout: '{"loggedIn":true}' }));
        return Promise.resolve(ok({ stdout: "PONG" }));
      }),
    };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
    await check.runPreflight();

    const authCall = processRunner.execute.mock.calls.find(
      ([opts]: [{ command: string; args: string[] }]) =>
        opts.command === "codex" && !opts.args.includes("--version"),
    )!;
    expect(authCall[0].stdinData).toBe("Respond with exactly: PONG");
  });
});
