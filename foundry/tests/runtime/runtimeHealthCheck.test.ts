import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import type { ProcessResult, ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";
import { PreflightError } from "../../src/utils/errors.js";

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function ok(stdout: string, overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout, stderr: "", exitCode: 0, durationMs: 5, timedOut: false, ...overrides };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs()", () => {
  it("builds command/version/probe configuration for all three runtimes", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--base"],
      "codex",
      ["exec", "-"],
      "cursor-agent",
    );

    expect(configs["claude-code"]).toMatchObject({
      command: "claude",
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: expect.any(String),
    });
    expect(configs.codex).toMatchObject({
      command: "codex",
      versionArgs: ["--version"],
      probeArgs: ["exec", "-"],
      probeStdin: expect.stringContaining("PONG"),
    });
    expect(configs.cursor).toMatchObject({
      command: "cursor-agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes()", () => {
  it("returns the distinct runtimes used by the configured agent stages", () => {
    const rhc = new RuntimeHealthCheck({ execute: vi.fn() } as never, {} as never, makeLogger() as never);
    const required = rhc.getRequiredRuntimes();
    // AGENT_STAGES only maps stages onto claude-code and codex today.
    expect(required).toEqual(new Set(["claude-code", "codex"]));
  });
});

describe("RuntimeHealthCheck.getLastResult()", () => {
  it("is undefined before runPreflight() has ever run", () => {
    const rhc = new RuntimeHealthCheck({ execute: vi.fn() } as never, {} as never, makeLogger() as never);
    expect(rhc.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight()", () => {
  const configs = RuntimeHealthCheck.buildRuntimeConfigs(
    "claude",
    [],
    "codex",
    ["exec", "-"],
    "cursor",
  );

  function makeExecute(
    impl: (opts: ProcessSpawnOptions) => ProcessResult | Promise<ProcessResult>,
  ) {
    return vi.fn(impl);
  }

  it("resolves ok=true, caches lastResult, and logs success when every required runtime passes", async () => {
    const execute = makeExecute((opts) => {
      if (opts.args.includes("--version")) return ok(`${opts.command} v1.0.0\n`);
      if (opts.command === "claude") return ok('{"loggedIn":true}');
      if (opts.command === "codex") return ok("PONG\n");
      throw new Error(`unexpected probe: ${opts.command} ${opts.args.join(" ")}`);
    });
    const logger = makeLogger();
    const rhc = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    const result = await rhc.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(typeof result.totalDurationMs).toBe("number");

    expect(rhc.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtimes: expect.any(Array) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("throws PreflightError and logs failures when a binary check fails", async () => {
    const execute = makeExecute((opts) => {
      if (opts.command === "codex" && opts.args.includes("--version")) {
        return { ...ok(""), exitCode: 127, stderr: "command not found" };
      }
      if (opts.args.includes("--version")) return ok(`${opts.command} v1.0.0\n`);
      if (opts.command === "claude") return ok('{"loggedIn":true}');
      throw new Error("codex auth probe should have been skipped");
    });
    const logger = makeLogger();
    const rhc = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    let caught: unknown;
    try {
      await rhc.runPreflight();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PreflightError);
    const preflightError = caught as PreflightError;
    expect(preflightError.result.ok).toBe(false);
    const codexResult = preflightError.result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.binaryCheck.ok).toBe(false);
    expect(codexResult.binaryCheck.error).toContain("Exit code 127");
    expect(codexResult.authCheck.ok).toBe(false);
    expect(codexResult.authCheck.error).toBe("Skipped: binary check failed");

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([expect.objectContaining({ runtime: "codex" })]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
    expect(rhc.getLastResult()?.ok).toBe(false);
  });

  it("throws PreflightError when the binary check passes but the auth check fails", async () => {
    const execute = makeExecute((opts) => {
      if (opts.args.includes("--version")) return ok(`${opts.command} v1.0.0\n`);
      if (opts.command === "claude") return ok('{"loggedIn":false}');
      if (opts.command === "codex") return ok("PONG\n");
      throw new Error("unexpected");
    });
    const rhc = new RuntimeHealthCheck({ execute } as never, configs, makeLogger() as never);

    let caught: unknown;
    try {
      await rhc.runPreflight();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PreflightError);
    const result = (caught as PreflightError).result;
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.ok).toBe(true);
    expect(claudeResult.authCheck.ok).toBe(false);
  });
});

describe("RuntimeHealthCheck internals -- checkBinary (white-box)", () => {
  function makeRhc(execute: ReturnType<typeof vi.fn>) {
    return new RuntimeHealthCheck({ execute } as never, {} as never, makeLogger() as never);
  }
  function checkBinary(rhc: RuntimeHealthCheck, config: unknown) {
    return (
      rhc as unknown as {
        checkBinary: (c: unknown) => Promise<{ ok: boolean; version?: string; error?: string }>;
      }
    ).checkBinary(config);
  }

  const config = { command: "claude", versionArgs: ["--version"], probeArgs: [] };

  it("reports ok with a trimmed, truncated version string on exit 0", async () => {
    const execute = vi.fn().mockResolvedValue(ok("  claude-cli v9.9.9\nextra ignored line\n"));
    const result = await checkBinary(makeRhc(execute), config);
    expect(result.ok).toBe(true);
    expect(result.version).toBe("claude-cli v9.9.9");
  });

  it("truncates an overly long version string to 100 characters", async () => {
    const execute = vi.fn().mockResolvedValue(ok("v" + "9".repeat(200)));
    const result = await checkBinary(makeRhc(execute), config);
    expect(result.version!.length).toBe(100);
  });

  it("reports not-ok with a timeout message when the probe times out", async () => {
    const execute = vi.fn().mockResolvedValue({ ...ok(""), timedOut: true });
    const result = await checkBinary(makeRhc(execute), config);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Timed out after \d+ms/);
  });

  it("reports not-ok with the exit code and stderr tail on a non-zero exit", async () => {
    const execute = vi.fn().mockResolvedValue({ ...ok(""), exitCode: 2, stderr: "bad binary" });
    const result = await checkBinary(makeRhc(execute), config);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Exit code 2: bad binary");
  });

  it("reports not-ok with the error message when execute() throws", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("ENOENT: not found"));
    const result = await checkBinary(makeRhc(execute), config);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("ENOENT: not found");
  });

  it("stringifies a non-Error throw from execute()", async () => {
    const execute = vi.fn().mockRejectedValue("raw string failure");
    const result = await checkBinary(makeRhc(execute), config);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("raw string failure");
  });
});

describe("RuntimeHealthCheck internals -- checkAuth (white-box)", () => {
  function makeRhc(execute: ReturnType<typeof vi.fn>) {
    return new RuntimeHealthCheck({ execute } as never, {} as never, makeLogger() as never);
  }
  function checkAuth(rhc: RuntimeHealthCheck, config: unknown) {
    return (
      rhc as unknown as {
        checkAuth: (c: unknown) => Promise<{ ok: boolean; error?: string }>;
      }
    ).checkAuth(config);
  }

  it("passes when successPattern matches stdout", async () => {
    const execute = vi.fn().mockResolvedValue(ok('{"loggedIn": true}'));
    const rhc = makeRhc(execute);
    const result = await checkAuth(rhc, {
      command: "claude",
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });
    expect(result.ok).toBe(true);
  });

  it("fails with a stdout snippet when successPattern does not match", async () => {
    const execute = vi.fn().mockResolvedValue(ok('{"loggedIn": false}'));
    const rhc = makeRhc(execute);
    const result = await checkAuth(rhc, {
      command: "claude",
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("expected pattern not found");
    expect(result.error).toContain('"loggedIn": false');
  });

  it("checks successPattern against stderr too (not just stdout)", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ ...ok(""), stderr: '{"loggedIn": true}' });
    const rhc = makeRhc(execute);
    const result = await checkAuth(rhc, {
      command: "claude",
      probeArgs: [],
      successPattern: '"loggedIn":\\s*true',
    });
    expect(result.ok).toBe(true);
  });

  it("exitCodeOnly passes on exit code 0 regardless of output", async () => {
    const execute = vi.fn().mockResolvedValue(ok(""));
    const rhc = makeRhc(execute);
    const result = await checkAuth(rhc, { command: "cursor", probeArgs: ["status"], exitCodeOnly: true });
    expect(result.ok).toBe(true);
  });

  it("exitCodeOnly fails with the exit code and output tail on non-zero exit", async () => {
    const execute = vi.fn().mockResolvedValue({ ...ok(""), exitCode: 1, stderr: "not logged in" });
    const rhc = makeRhc(execute);
    const result = await checkAuth(rhc, { command: "cursor", probeArgs: ["status"], exitCodeOnly: true });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Exit code 1: not logged in");
  });

  it("exitCodeOnly falls back to stdout for the error tail when stderr is empty", async () => {
    const execute = vi.fn().mockResolvedValue({ ...ok("stdout failure text"), exitCode: 1 });
    const rhc = makeRhc(execute);
    const result = await checkAuth(rhc, { command: "cursor", probeArgs: ["status"], exitCodeOnly: true });
    expect(result.error).toBe("Exit code 1: stdout failure text");
  });

  it("pong fallback: passes on exit 0 with PONG in the output", async () => {
    const execute = vi.fn().mockResolvedValue(ok("PONG"));
    const rhc = makeRhc(execute);
    const result = await checkAuth(rhc, { command: "codex", probeArgs: [] });
    expect(result.ok).toBe(true);
  });

  it("pong fallback: passes even on a non-zero exit as long as PONG is present (case-insensitive)", async () => {
    const execute = vi.fn().mockResolvedValue({ ...ok("...pong..."), exitCode: 1 });
    const rhc = makeRhc(execute);
    const result = await checkAuth(rhc, { command: "codex", probeArgs: [] });
    expect(result.ok).toBe(true);
  });

  it("pong fallback: fails with the exit code when there is no PONG and exit is non-zero", async () => {
    const execute = vi.fn().mockResolvedValue({ ...ok(""), exitCode: 1, stderr: "connection refused" });
    const rhc = makeRhc(execute);
    const result = await checkAuth(rhc, { command: "codex", probeArgs: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Exit code 1: connection refused");
  });

  it("pong fallback: fails when exit is 0 but no PONG was returned", async () => {
    const execute = vi.fn().mockResolvedValue(ok("some unrelated chit-chat"));
    const rhc = makeRhc(execute);
    const result = await checkAuth(rhc, { command: "codex", probeArgs: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("did not return expected response");
  });

  it("reports a timeout distinctly from other auth failures", async () => {
    const execute = vi.fn().mockResolvedValue({ ...ok(""), timedOut: true });
    const rhc = makeRhc(execute);
    const result = await checkAuth(rhc, { command: "codex", probeArgs: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Auth probe timed out after \d+ms/);
  });

  it("passes stdinData through to execute() when probeStdin is configured", async () => {
    const execute = vi.fn().mockResolvedValue(ok("PONG"));
    const rhc = makeRhc(execute);
    await checkAuth(rhc, { command: "codex", probeArgs: ["exec", "-"], probeStdin: "Respond: PONG" });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ stdinData: "Respond: PONG" }),
    );
  });

  it("reports not-ok with the error message when execute() throws", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("socket hang up"));
    const rhc = makeRhc(execute);
    const result = await checkAuth(rhc, { command: "codex", probeArgs: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("socket hang up");
  });

  it("stringifies a non-Error throw from execute()", async () => {
    const execute = vi.fn().mockRejectedValue("raw string failure");
    const rhc = makeRhc(execute);
    const result = await checkAuth(rhc, { command: "codex", probeArgs: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("raw string failure");
  });
});
