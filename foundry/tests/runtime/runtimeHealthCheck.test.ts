import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function ok(stdout = "", stderr = "", exitCode = 0, timedOut = false): ProcessResult {
  return { stdout, stderr, exitCode, durationMs: 5, timedOut };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds a config per runtime with the expected commands and probe shapes", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--flag"],
      "codex",
      ["exec", "-"],
      "cursor",
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
      command: "cursor",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes", () => {
  it("derives the required runtime set from AGENT_STAGES (claude-code and codex, never cursor)", () => {
    const check = new RuntimeHealthCheck({} as never, {} as never, makeLogger() as never);
    const required = check.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });
});

describe("RuntimeHealthCheck.getLastResult", () => {
  it("is undefined before any preflight has run", () => {
    const check = new RuntimeHealthCheck({} as never, {} as never, makeLogger() as never);
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight — happy path", () => {
  it("returns ok:true, skips cursor, and logs a pass when every required runtime is healthy", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      // version probe
      if (opts.args.includes("--version")) {
        return ok(`${opts.command} v1.2.3`);
      }
      // auth probe
      if (opts.command === "claude") {
        return ok('{"loggedIn": true}');
      }
      if (opts.command === "codex") {
        return ok("PONG");
      }
      return ok();
    });
    const processRunner = { execute };
    const logger = makeLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.binaryCheck.ok && r.authCheck.ok)).toBe(true);
    expect(typeof result.totalDurationMs).toBe("number");

    expect(check.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("RuntimeHealthCheck.runPreflight — failure paths", () => {
  it("throws PreflightError and logs failures when the binary check fails for a runtime", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      if (opts.args.includes("--version") && opts.command === "claude") {
        return ok("", "command not found", 127);
      }
      if (opts.args.includes("--version")) {
        return ok(`${opts.command} v1.0.0`);
      }
      if (opts.command === "codex") return ok("PONG");
      return ok();
    });
    const processRunner = { execute };
    const logger = makeLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ runtime: "claude-code", binaryError: expect.stringContaining("Exit code 127") }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );

    // Auth check is skipped entirely once the binary check fails for that runtime.
    const lastResult = check.getLastResult();
    const claudeResult = lastResult?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck).toEqual({
      ok: false,
      durationMs: 0,
      error: "Skipped: binary check failed",
    });
  });

  it("throws PreflightError carrying the preflight summary on its .result", async () => {
    const execute = vi.fn(async (): Promise<ProcessResult> => ok("", "down", 1));
    const processRunner = { execute };
    const logger = makeLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    try {
      await check.runPreflight();
      throw new Error("expected runPreflight to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightError);
      const e = err as PreflightError;
      expect(e.result.ok).toBe(false);
      expect(e.message).toContain("Preflight failed for runtimes");
    }
  });
});

describe("RuntimeHealthCheck.checkBinary (via probeRuntime)", () => {
  let logger: ReturnType<typeof makeLogger>;
  let configs: ReturnType<typeof RuntimeHealthCheck.buildRuntimeConfigs>;

  beforeEach(() => {
    logger = makeLogger();
    configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
  });

  it("marks the binary check as failed when the version probe times out", async () => {
    const execute = vi.fn(async (opts: { args: string[] }): Promise<ProcessResult> => {
      if (opts.args.includes("--version")) {
        return { stdout: "", stderr: "", exitCode: 1, durationMs: 5000, timedOut: true };
      }
      return ok("PONG");
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.binaryCheck.ok).toBe(false);
    expect(claude?.binaryCheck.error).toMatch(/Timed out after \d+ms/);
  });

  it("marks the binary check as failed with the error message when execute() rejects", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      if (opts.args.includes("--version") && opts.command === "claude") {
        throw new Error("ENOENT: spawn claude");
      }
      if (opts.args.includes("--version")) return ok("v1");
      return ok("PONG");
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.binaryCheck.ok).toBe(false);
    expect(claude?.binaryCheck.error).toBe("ENOENT: spawn claude");
  });

  it("extracts the first line of stdout (truncated to 100 chars) as the version string on success", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      if (opts.args.includes("--version")) {
        return ok(`${opts.command} version 9.9.9\nextra ignored line`);
      }
      if (opts.command === "codex") return ok("PONG");
      return ok('{"loggedIn": true}');
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    const result = await check.runPreflight();
    const claude = result.results.find((r) => r.runtime === "claude-code");
    expect(claude?.binaryCheck.ok).toBe(true);
    expect(claude?.binaryCheck.version).toBe("claude version 9.9.9");
  });
});

describe("RuntimeHealthCheck.checkAuth (via probeRuntime)", () => {
  let logger: ReturnType<typeof makeLogger>;
  let configs: ReturnType<typeof RuntimeHealthCheck.buildRuntimeConfigs>;

  beforeEach(() => {
    logger = makeLogger();
    configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "cursor");
  });

  it("fails when the auth probe times out", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      if (opts.args.includes("--version")) return ok("v1");
      if (opts.command === "claude") {
        return { stdout: "", stderr: "", exitCode: 0, durationMs: 30000, timedOut: true };
      }
      return ok("PONG");
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.authCheck.ok).toBe(false);
    expect(claude?.authCheck.error).toMatch(/Auth probe timed out after \d+ms/);
  });

  it("fails the successPattern check when the expected pattern is not found in stdout/stderr", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      if (opts.args.includes("--version")) return ok("v1");
      if (opts.command === "claude") return ok('{"loggedIn": false}');
      return ok("PONG");
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.authCheck.ok).toBe(false);
    expect(claude?.authCheck.error).toContain("Auth check failed: expected pattern not found");
  });

  it("passes the successPattern check when the pattern matches stdout", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      if (opts.args.includes("--version")) return ok("v1");
      if (opts.command === "claude") return ok('{"loggedIn": true}');
      return ok("PONG");
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    const result = await check.runPreflight();
    const claude = result.results.find((r) => r.runtime === "claude-code");
    expect(claude?.authCheck).toEqual({ ok: true, durationMs: expect.any(Number) });
  });

  it("falls back to hasPong matching for runtimes with neither successPattern nor exitCodeOnly (codex)", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      if (opts.args.includes("--version")) return ok("v1");
      if (opts.command === "claude") return ok('{"loggedIn": true}');
      // codex auth probe: no PONG anywhere, but exit code 0
      return ok("nothing useful here");
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codex = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codex?.authCheck.ok).toBe(false);
    expect(codex?.authCheck.error).toContain("Auth probe did not return expected response");
  });

  it("fails the hasPong check with the exit-code error when exit is non-zero and no PONG is present", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      if (opts.args.includes("--version")) return ok("v1");
      if (opts.command === "claude") return ok('{"loggedIn": true}');
      return ok("", "connection refused", 1);
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codex = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codex?.authCheck.ok).toBe(false);
    expect(codex?.authCheck.error).toContain("Exit code 1: connection refused");
  });

  it("passes the hasPong check when PONG is present even if mixed with other output", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      if (opts.args.includes("--version")) return ok("v1");
      if (opts.command === "claude") return ok('{"loggedIn": true}');
      return ok("thinking...\nPONG\n");
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    const result = await check.runPreflight();
    const codex = result.results.find((r) => r.runtime === "codex");
    expect(codex?.authCheck.ok).toBe(true);
  });

  it("catches a rejected auth probe and reports its error message", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }): Promise<ProcessResult> => {
      if (opts.args.includes("--version")) return ok("v1");
      if (opts.command === "claude") throw new Error("auth probe crashed");
      return ok("PONG");
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.authCheck.ok).toBe(false);
    expect(claude?.authCheck.error).toBe("auth probe crashed");
  });

  // "cursor" is configured with exitCodeOnly, but AGENT_STAGES never routes a
  // stage to the cursor runtime, so getRequiredRuntimes() never selects it and
  // runPreflight() can never reach this branch through the public API. We
  // invoke the private checkAuth directly (via a cast) to cover it, since it
  // is otherwise completely unreachable/untestable code in this class.
  describe("exitCodeOnly branch (cursor) — exercised directly since it is unreachable via runPreflight", () => {
    it("passes when exit code is 0", async () => {
      const execute = vi.fn(async (): Promise<ProcessResult> => ok("ready"));
      const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const authCheck = await (check as any).checkAuth(configs.cursor);
      expect(authCheck).toEqual({ ok: true, durationMs: expect.any(Number) });
    });

    it("fails with the exit-code error when exit code is non-zero", async () => {
      const execute = vi.fn(async (): Promise<ProcessResult> => ok("", "not logged in", 3));
      const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const authCheck = await (check as any).checkAuth(configs.cursor);
      expect(authCheck.ok).toBe(false);
      expect(authCheck.error).toContain("Exit code 3: not logged in");
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
