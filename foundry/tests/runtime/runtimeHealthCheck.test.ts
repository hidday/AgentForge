import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult, ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function okResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 5, timedOut: false, ...overrides };
}

function makeConfigs() {
  return {
    "claude-code": {
      command: "claude",
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    },
    codex: {
      command: "codex",
      versionArgs: ["--version"],
      probeArgs: [],
      probeStdin: "Respond with exactly: PONG",
    },
    cursor: {
      command: "cursor-agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    },
  };
}

/**
 * Builds a processRunner.execute mock that dispatches on which args were
 * passed (version vs. probe args), rather than on call order — probeRuntime
 * for each required runtime runs concurrently via Promise.all, so the raw
 * call order across runtimes is not "runtime1 binary, runtime1 auth,
 * runtime2 binary, runtime2 auth".
 */
function makeExecute(handlers: {
  version?: (opts: ProcessSpawnOptions) => ProcessResult | Promise<ProcessResult>;
  probe?: (opts: ProcessSpawnOptions) => ProcessResult | Promise<ProcessResult>;
}) {
  return vi.fn(async (opts: ProcessSpawnOptions) => {
    const isVersionCall = opts.args.length === 1 && opts.args[0] === "--version";
    if (isVersionCall) {
      return (handlers.version ?? (() => okResult({ stdout: "v1.0.0\n" })))(opts);
    }
    return (handlers.probe ?? (() => okResult({ stdout: "PONG" })))(opts);
  });
}

const defaultHandlers = {
  version: () => okResult({ stdout: "v1.0.0\n" }),
  probe: (opts: ProcessSpawnOptions) => {
    if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
    return okResult({ stdout: "PONG" });
  },
};

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds configs for all three runtimes from the given commands", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "cursor-agent");
    expect(configs["claude-code"].command).toBe("claude");
    expect(configs["claude-code"].successPattern).toBeDefined();
    expect(configs.codex.command).toBe("codex");
    expect(configs.codex.probeStdin).toContain("PONG");
    expect(configs.cursor.command).toBe("cursor-agent");
    expect(configs.cursor.exitCodeOnly).toBe(true);
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes", () => {
  it("derives the required runtime set from AGENT_STAGES (claude-code and codex, not cursor)", () => {
    const check = new RuntimeHealthCheck(
      { execute: vi.fn() } as never,
      makeConfigs() as never,
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
      { execute: vi.fn() } as never,
      makeConfigs() as never,
      makeLogger() as never,
    );
    expect(check.getLastResult()).toBeUndefined();
  });

  it("caches the most recent preflight result", async () => {
    const check = new RuntimeHealthCheck(
      { execute: makeExecute(defaultHandlers) } as never,
      makeConfigs() as never,
      makeLogger() as never,
    );
    const result = await check.runPreflight();
    expect(check.getLastResult()).toBe(result);
  });
});

describe("RuntimeHealthCheck.runPreflight — success path", () => {
  it("resolves ok:true when all required runtimes pass binary + auth checks", async () => {
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(
      { execute: makeExecute(defaultHandlers) } as never,
      makeConfigs() as never,
      logger as never,
    );

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"].sort());
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck).toMatchObject({ ok: true, version: "v1.0.0" });
    expect(claude.authCheck).toMatchObject({ ok: true });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });
});

describe("RuntimeHealthCheck.runPreflight — failure paths", () => {
  it("throws PreflightError and skips the auth check when the binary check fails", async () => {
    const logger = makeLogger();
    const execute = makeExecute({
      version: (opts) =>
        opts.command === "claude"
          ? okResult({ exitCode: 127, stderr: "command not found" })
          : okResult({ stdout: "v1.0.0\n" }),
      probe: defaultHandlers.probe,
    });
    const check = new RuntimeHealthCheck({ execute } as never, makeConfigs() as never, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const lastResult = check.getLastResult()!;
    expect(lastResult.ok).toBe(false);
    const claude = lastResult.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(false);
    expect(claude.authCheck).toMatchObject({ ok: false, error: "Skipped: binary check failed" });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([expect.objectContaining({ runtime: "claude-code" })]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("reports a binaryCheck timeout", async () => {
    const execute = makeExecute({
      version: (opts) =>
        opts.command === "claude" ? okResult({ timedOut: true }) : okResult({ stdout: "v1.0.0\n" }),
      probe: defaultHandlers.probe,
    });
    const check = new RuntimeHealthCheck({ execute } as never, makeConfigs() as never, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck).toMatchObject({ ok: false, error: expect.stringContaining("Timed out") });
  });

  it("catches a binaryCheck execute() rejection with an Error message", async () => {
    const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        throw new Error("spawn ENOENT");
      }
      return opts.args[0] === "--version" ? okResult({ stdout: "v1.0.0\n" }) : okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck({ execute } as never, makeConfigs() as never, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck).toMatchObject({ ok: false, error: "spawn ENOENT" });
  });

  it("catches a binaryCheck execute() rejection with a non-Error value", async () => {
    const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        throw "raw string failure";
      }
      return opts.args[0] === "--version" ? okResult({ stdout: "v1.0.0\n" }) : okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck({ execute } as never, makeConfigs() as never, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck).toMatchObject({ ok: false, error: "raw string failure" });
  });

  it("fails auth when the binary check passes but the successPattern doesn't match", async () => {
    const execute = makeExecute({
      version: defaultHandlers.version,
      probe: (opts) =>
        opts.command === "claude" ? okResult({ stdout: '{"loggedIn": false}' }) : okResult({ stdout: "PONG" }),
    });
    const check = new RuntimeHealthCheck({ execute } as never, makeConfigs() as never, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck).toMatchObject({
      ok: false,
      error: expect.stringContaining("expected pattern not found"),
    });
  });

  it("times out the auth probe", async () => {
    const execute = makeExecute({
      version: defaultHandlers.version,
      probe: (opts) => (opts.command === "claude" ? okResult({ timedOut: true }) : okResult({ stdout: "PONG" })),
    });
    const check = new RuntimeHealthCheck({ execute } as never, makeConfigs() as never, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck).toMatchObject({
      ok: false,
      error: expect.stringContaining("Auth probe timed out"),
    });
  });

  it("catches a checkAuth execute() rejection with a non-Error value", async () => {
    const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
      if (opts.command === "claude" && opts.args[0] !== "--version") {
        throw { weird: "object" };
      }
      return opts.args[0] === "--version" ? okResult({ stdout: "v1.0.0\n" }) : okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck({ execute } as never, makeConfigs() as never, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck).toMatchObject({ ok: false, error: "[object Object]" });
  });

  it("catches a checkAuth execute() rejection with an Error message", async () => {
    const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
      if (opts.command === "claude" && opts.args[0] !== "--version") {
        throw new Error("auth probe crashed");
      }
      return opts.args[0] === "--version" ? okResult({ stdout: "v1.0.0\n" }) : okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck({ execute } as never, makeConfigs() as never, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck).toMatchObject({ ok: false, error: "auth probe crashed" });
  });

  it("exitCodeOnly failure message falls back to stdout when stderr is empty", async () => {
    const execute = makeExecute({
      version: defaultHandlers.version,
      probe: (opts) =>
        opts.command === "cursor-agent"
          ? okResult({ exitCode: 1, stderr: "", stdout: "not authenticated" })
          : okResult({ stdout: "PONG" }),
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      { "claude-code": makeConfigs().cursor, codex: makeConfigs().codex } as never,
      makeLogger() as never,
    );
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const r = check.getLastResult()!.results.find((x) => x.runtime === "claude-code")!;
    expect(r.authCheck).toMatchObject({
      ok: false,
      error: expect.stringContaining("not authenticated"),
    });
  });

  it("exitCodeOnly auth check fails on a non-zero exit code", async () => {
    // AGENT_STAGES never routes a stage to "cursor", so to exercise
    // exitCodeOnly-based auth (cursor's config shape) through the public
    // runPreflight path, we wire cursor's config into the "claude-code"
    // slot, which IS always required.
    const execute = makeExecute({
      version: defaultHandlers.version,
      probe: (opts) =>
        opts.command === "cursor-agent" ? okResult({ exitCode: 1, stderr: "nope" }) : okResult({ stdout: "PONG" }),
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      { "claude-code": makeConfigs().cursor, codex: makeConfigs().codex } as never,
      makeLogger() as never,
    );
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const r = check.getLastResult()!.results.find((x) => x.runtime === "claude-code")!;
    expect(r.authCheck).toMatchObject({ ok: false, error: expect.stringContaining("Exit code 1") });
  });

  it("exitCodeOnly auth check passes on exit code 0", async () => {
    const execute = makeExecute({
      version: defaultHandlers.version,
      probe: (opts) =>
        opts.command === "cursor-agent" ? okResult({ exitCode: 0 }) : okResult({ stdout: "PONG" }),
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      { "claude-code": makeConfigs().cursor, codex: makeConfigs().codex } as never,
      makeLogger() as never,
    );
    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });

  it("PONG-based auth check fails on non-zero exit without pong in output", async () => {
    const noPattern = { ...makeConfigs()["claude-code"], successPattern: undefined };
    const execute = makeExecute({
      version: defaultHandlers.version,
      probe: (opts) =>
        opts.command === "claude" ? okResult({ exitCode: 2, stderr: "boom" }) : okResult({ stdout: "PONG" }),
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      { "claude-code": noPattern, codex: makeConfigs().codex } as never,
      makeLogger() as never,
    );
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const r = check.getLastResult()!.results.find((x) => x.runtime === "claude-code")!;
    expect(r.authCheck).toMatchObject({ ok: false, error: expect.stringContaining("Exit code 2") });
  });

  it("PONG-based auth check fails on a zero exit code with no pong in output", async () => {
    const noPattern = { ...makeConfigs()["claude-code"], successPattern: undefined };
    const execute = makeExecute({
      version: defaultHandlers.version,
      probe: (opts) =>
        opts.command === "claude"
          ? okResult({ exitCode: 0, stdout: "not the expected text" })
          : okResult({ stdout: "PONG" }),
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      { "claude-code": noPattern, codex: makeConfigs().codex } as never,
      makeLogger() as never,
    );
    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const r = check.getLastResult()!.results.find((x) => x.runtime === "claude-code")!;
    expect(r.authCheck).toMatchObject({
      ok: false,
      error: expect.stringContaining("did not return expected response"),
    });
  });

  it("PONG-based auth check passes when the output contains pong", async () => {
    const noPattern = { ...makeConfigs()["claude-code"], successPattern: undefined };
    const execute = makeExecute({
      version: defaultHandlers.version,
      probe: (opts) =>
        opts.command === "claude" ? okResult({ exitCode: 0, stdout: "PONG" }) : okResult({ stdout: "PONG" }),
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      { "claude-code": noPattern, codex: makeConfigs().codex } as never,
      makeLogger() as never,
    );
    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });
});
