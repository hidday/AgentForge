import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function ok(stdout = "v1.0.0", exitCode = 0): ProcessResult {
  return { stdout, stderr: "", exitCode, durationMs: 5, timedOut: false };
}

function fail(stderr = "boom", exitCode = 1): ProcessResult {
  return { stdout: "", stderr, exitCode, durationMs: 5, timedOut: false };
}

function timedOut(): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 1, durationMs: 5, timedOut: true };
}

const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds per-runtime probe configs with the expected commands and auth strategies", () => {
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
  it("returns the distinct set of runtimes used across AGENT_STAGES", () => {
    const check = new RuntimeHealthCheck({ execute: vi.fn() } as never, configs, makeLogger() as never);
    const required = check.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
  });

  it("returns undefined from getLastResult before runPreflight has ever run", () => {
    const check = new RuntimeHealthCheck({ execute: vi.fn() } as never, configs, makeLogger() as never);
    expect(check.getLastResult()).toBeUndefined();
  });

  it("caches the most recent result and exposes it via getLastResult", async () => {
    const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("auth")) return Promise.resolve(ok('{"loggedIn": true}'));
      if (opts.args.includes("exec")) return Promise.resolve(ok("PONG"));
      return Promise.resolve(ok());
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);
    const result = await check.runPreflight();
    expect(check.getLastResult()).toBe(result);
  });
});

describe("RuntimeHealthCheck.runPreflight — success path", () => {
  it("reports ok=true and lists cursor as skipped (not required by any AGENT_STAGES entry)", async () => {
    const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("auth")) {
        return Promise.resolve(ok('{"loggedIn": true}'));
      }
      if (opts.args.includes("exec")) {
        return Promise.resolve(ok("PONG"));
      }
      return Promise.resolve(ok());
    });
    const logger = makeLogger();
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"].sort());
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(typeof result.totalDurationMs).toBe("number");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });
});

describe("RuntimeHealthCheck.runPreflight — failure paths", () => {
  it("throws PreflightError and logs failures when a binary check fails", async () => {
    const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.command === "claude") return Promise.resolve(fail("not found", 127));
      if (opts.args.includes("exec")) return Promise.resolve(ok("PONG"));
      return Promise.resolve(ok());
    });
    const logger = makeLogger();
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([expect.objectContaining({ runtime: "claude-code" })]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("skips the auth check (marks it failed) when the binary check itself fails", async () => {
    const execute = vi.fn().mockResolvedValue(fail("no such file", 127));
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);

    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }

    expect(caught).toBeInstanceOf(PreflightError);
    const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.ok).toBe(false);
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toBe("Skipped: binary check failed");
    // The process runner should only be invoked once per runtime (version check),
    // never for the auth probe, once the binary check has failed.
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

describe("RuntimeHealthCheck — checkBinary", () => {
  it("marks ok=false with a timeout message when the version probe times out", async () => {
    const execute = vi.fn().mockResolvedValue(timedOut());
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    expect(result.results[0]!.binaryCheck.error).toContain("Timed out after");
  });

  it("marks ok=false with exit-code detail when the version probe exits non-zero", async () => {
    const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return Promise.resolve(fail("permission denied", 126));
      return Promise.resolve(ok());
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);
    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.error).toContain("Exit code 126");
    expect(claudeResult.binaryCheck.error).toContain("permission denied");
  });

  it("extracts the first line of stdout (truncated to 100 chars) as the version string", async () => {
    const longVersion = "v" + "9".repeat(150);
    const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return Promise.resolve(ok(`${longVersion}\nextra line`));
      if (opts.args.includes("exec")) return Promise.resolve(ok("PONG"));
      return Promise.resolve(ok('{"loggedIn": true}'));
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);
    const result = await check.runPreflight();
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.version).toHaveLength(100);
    expect(claudeResult.binaryCheck.version).toBe(longVersion.slice(0, 100));
  });

  it("marks ok=false with the exception message when the process runner throws", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("spawn EACCES"));
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);
    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.error).toBe("spawn EACCES");
  });

  it("stringifies a non-Error throw from the process runner", async () => {
    const execute = vi.fn().mockRejectedValue("just a string failure");
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);
    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.error).toBe("just a string failure");
  });
});

describe("RuntimeHealthCheck — checkAuth (successPattern strategy, e.g. claude-code)", () => {
  it("passes when the success pattern matches stdout", async () => {
    const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("auth")) return Promise.resolve(ok('{"loggedIn": true}'));
      return Promise.resolve(ok("PONG"));
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);
    const result = await check.runPreflight();
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(true);
  });

  it("passes when the success pattern matches stderr instead of stdout", async () => {
    const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("auth")) {
        return Promise.resolve({
          stdout: "",
          stderr: '{"loggedIn": true}',
          exitCode: 0,
          durationMs: 5,
          timedOut: false,
        });
      }
      return Promise.resolve(ok("PONG"));
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);
    const result = await check.runPreflight();
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(true);
  });

  it("fails when the success pattern does not match", async () => {
    const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("auth")) return Promise.resolve(ok('{"loggedIn": false}'));
      return Promise.resolve(ok("PONG"));
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);
    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toContain("expected pattern not found");
  });

  it("marks the auth check failed with a timeout message when the probe times out", async () => {
    const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("auth")) return Promise.resolve(timedOut());
      return Promise.resolve(ok("PONG"));
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);
    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.error).toContain("Auth probe timed out after");
  });

  it("catches and reports an exception thrown by the process runner during the auth probe", async () => {
    const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("auth")) return Promise.reject(new Error("socket hang up"));
      return Promise.resolve(ok("PONG"));
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);
    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    const claudeResult = caught!.result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.error).toBe("socket hang up");
  });
});

describe("RuntimeHealthCheck — checkAuth (exitCodeOnly strategy, e.g. cursor)", () => {
  // Cursor is never in AGENT_STAGES' required runtimes, so drive its probe
  // directly via a health check instance configured to require it.
  const cursorOnlyConfigs = { ...configs };

  function makeCursorOnlyCheck(execute: ReturnType<typeof vi.fn>) {
    const check = new RuntimeHealthCheck({ execute } as never, cursorOnlyConfigs, makeLogger() as never);
    vi.spyOn(check, "getRequiredRuntimes").mockReturnValue(new Set(["cursor"]));
    return check;
  }

  it("passes on exit code 0 alone", async () => {
    const execute = vi.fn().mockResolvedValue(ok());
    const check = makeCursorOnlyCheck(execute);
    const result = await check.runPreflight();
    expect(result.results[0]!.authCheck.ok).toBe(true);
  });

  it("fails with exit-code detail on non-zero exit", async () => {
    const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return Promise.resolve(ok());
      return Promise.resolve(fail("not logged in", 1));
    });
    const check = makeCursorOnlyCheck(execute);
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    expect(result.results[0]!.authCheck.error).toContain("Exit code 1");
    expect(result.results[0]!.authCheck.error).toContain("not logged in");
  });

  it("falls back to stdout for the error detail when stderr is empty", async () => {
    const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return Promise.resolve(ok());
      return Promise.resolve({ stdout: "denied", stderr: "", exitCode: 1, durationMs: 1, timedOut: false });
    });
    const check = makeCursorOnlyCheck(execute);
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    expect(result.results[0]!.authCheck.error).toContain("denied");
  });
});

describe("RuntimeHealthCheck — checkAuth (PONG strategy, e.g. codex)", () => {
  it("passes when output contains 'pong' case-insensitively, even with non-zero exit code", async () => {
    const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("auth")) return Promise.resolve(ok('{"loggedIn": true}'));
      if (opts.args.includes("exec")) {
        return Promise.resolve({ stdout: "PoNg", stderr: "", exitCode: 1, durationMs: 1, timedOut: false });
      }
      return Promise.resolve(ok());
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);
    const result = await check.runPreflight();
    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(true);
  });

  it("fails with exit-code detail when exit is non-zero and no PONG is present", async () => {
    const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("auth")) return Promise.resolve(ok('{"loggedIn": true}'));
      if (opts.args.includes("exec")) return Promise.resolve(fail("rate limited", 1));
      return Promise.resolve(ok());
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);
    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    const codexResult = caught!.result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.error).toContain("Exit code 1");
    expect(codexResult.authCheck.error).toContain("rate limited");
  });

  it("fails with an unexpected-response message when exit is 0 but no PONG is present", async () => {
    const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("auth")) return Promise.resolve(ok('{"loggedIn": true}'));
      if (opts.args.includes("exec")) return Promise.resolve(ok("I refuse to respond"));
      return Promise.resolve(ok());
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);
    let caught: PreflightError | undefined;
    try {
      await check.runPreflight();
    } catch (err) {
      caught = err as PreflightError;
    }
    const codexResult = caught!.result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.error).toContain("did not return expected response");
  });

  it("sends probeStdin (the PONG instruction) to the process runner", async () => {
    const execute = vi.fn().mockImplementation((opts: { args: string[] }) => {
      if (opts.args.includes("auth")) return Promise.resolve(ok('{"loggedIn": true}'));
      if (opts.args.includes("exec")) return Promise.resolve(ok("PONG"));
      return Promise.resolve(ok());
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);
    await check.runPreflight();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ stdinData: "Respond with exactly: PONG" }),
    );
  });
});
