import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult, ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function okResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 5, timedOut: false, ...overrides };
}

/** A fully-passing config for a runtime whose branches aren't under test in a given case. */
function passingConfig(command: string) {
  return {
    command,
    versionArgs: ["--version"],
    probeArgs: ["probe"],
    exitCodeOnly: true,
  };
}

/** Routes execute() calls by whether args match versionArgs or probeArgs for a known command. */
function buildExecuteMock(
  handlers: Record<
    string,
    { version: ProcessResult | Error; probe: ProcessResult | Error }
  >,
) {
  return vi.fn().mockImplementation(async (opts: ProcessSpawnOptions) => {
    const handler = handlers[opts.command];
    if (!handler) throw new Error(`Unexpected command: ${opts.command}`);
    const isVersionCall = opts.timeoutMs === 5_000;
    const outcome = isVersionCall ? handler.version : handler.probe;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds configs for claude-code, codex, and cursor with the right shape", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--base"],
      "codex",
      ["exec"],
      "cursor-agent",
    );

    expect(configs["claude-code"].command).toBe("claude");
    expect(configs["claude-code"].probeArgs).toEqual(["auth", "status"]);
    expect(configs["claude-code"].successPattern).toBeDefined();

    expect(configs.codex.command).toBe("codex");
    expect(configs.codex.probeArgs).toEqual(["exec"]);
    expect(configs.codex.probeStdin).toContain("PONG");

    expect(configs.cursor.command).toBe("cursor-agent");
    expect(configs.cursor.probeArgs).toEqual(["status"]);
    expect(configs.cursor.exitCodeOnly).toBe(true);
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes", () => {
  it("derives the required runtime set from AGENT_STAGES (claude-code and codex, not cursor)", () => {
    const health = new RuntimeHealthCheck({} as never, {} as never, makeLogger());
    const required = health.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });
});

describe("RuntimeHealthCheck.getLastResult", () => {
  it("is undefined before any preflight has run", () => {
    const health = new RuntimeHealthCheck({} as never, {} as never, makeLogger());
    expect(health.getLastResult()).toBeUndefined();
  });

  it("stores the result even when the preflight ultimately fails", async () => {
    const execute = buildExecuteMock({
      "claude-ok": { version: okResult(), probe: okResult() },
      "codex-fail": { version: okResult({ timedOut: true }), probe: okResult() },
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": passingConfig("claude-ok"),
        codex: passingConfig("codex-fail"),
        cursor: passingConfig("cursor-unused"),
      } as never,
      makeLogger(),
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    expect(health.getLastResult()).toBeDefined();
    expect(health.getLastResult()?.ok).toBe(false);
  });
});

describe("RuntimeHealthCheck.runPreflight — success path", () => {
  it("resolves ok:true and logs a pass when every required runtime's binary and auth checks succeed", async () => {
    const execute = buildExecuteMock({
      "claude-ok": { version: okResult({ stdout: "v1.2.3\n" }), probe: okResult() },
      "codex-ok": { version: okResult({ stdout: "v9.9.9\n" }), probe: okResult() },
    });
    const logger = makeLogger();
    const health = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": passingConfig("claude-ok"),
        codex: passingConfig("codex-ok"),
        cursor: passingConfig("cursor-unused"),
      } as never,
      logger,
    );

    const result = await health.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    for (const r of result.results) {
      expect(r.binaryCheck.ok).toBe(true);
      expect(r.authCheck.ok).toBe(true);
    }
    expect(
      logger.info.mock.calls.some((c) => c[1] === "Preflight passed: all agent runtimes are accessible and authenticated"),
    ).toBe(true);
  });

  it("extracts and truncates the version string from the first line of stdout", async () => {
    const execute = buildExecuteMock({
      "claude-ok": { version: okResult({ stdout: "v1.0.0\nextra ignored line" }), probe: okResult() },
      "codex-ok": { version: okResult({ stdout: "v2.0.0" }), probe: okResult() },
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": passingConfig("claude-ok"),
        codex: passingConfig("codex-ok"),
        cursor: passingConfig("cursor-unused"),
      } as never,
      makeLogger(),
    );

    const result = await health.runPreflight();
    const claude = result.results.find((r) => r.runtime === "claude-code");
    expect(claude?.binaryCheck.version).toBe("v1.0.0");
  });
});

describe("RuntimeHealthCheck.runPreflight — binary check failure branches", () => {
  it("fails with a timeout error and skips the auth check when the version probe times out", async () => {
    const execute = buildExecuteMock({
      "claude-timeout": { version: okResult({ timedOut: true }), probe: okResult() },
      "codex-ok": { version: okResult(), probe: okResult() },
    });
    const logger = makeLogger();
    const health = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": passingConfig("claude-timeout"),
        codex: passingConfig("codex-ok"),
        cursor: passingConfig("cursor-unused"),
      } as never,
      logger,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const result = health.getLastResult()!;
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(false);
    expect(claude.binaryCheck.error).toMatch(/Timed out after/);
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toBe("Skipped: binary check failed");
    expect(
      logger.error.mock.calls.some((c) => c[1] === "Preflight FAILED: one or more agent runtimes are not ready"),
    ).toBe(true);
  });

  it("reports a non-zero exit code from the version probe, truncated to 200 chars", async () => {
    const execute = buildExecuteMock({
      "claude-badexit": {
        version: okResult({ exitCode: 1, stderr: "boom" }),
        probe: okResult(),
      },
      "codex-ok": { version: okResult(), probe: okResult() },
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": passingConfig("claude-badexit"),
        codex: passingConfig("codex-ok"),
        cursor: passingConfig("cursor-unused"),
      } as never,
      makeLogger(),
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claude = health.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(false);
    expect(claude.binaryCheck.error).toBe("Exit code 1: boom");
  });

  it("catches a thrown error from the process runner and reports its message", async () => {
    const execute = buildExecuteMock({
      "claude-throws": { version: new Error("spawn ENOENT"), probe: okResult() },
      "codex-ok": { version: okResult(), probe: okResult() },
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": passingConfig("claude-throws"),
        codex: passingConfig("codex-ok"),
        cursor: passingConfig("cursor-unused"),
      } as never,
      makeLogger(),
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claude = health.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(false);
    expect(claude.binaryCheck.error).toBe("spawn ENOENT");
  });
});

describe("RuntimeHealthCheck.runPreflight — auth check branches (successPattern)", () => {
  function configWithPattern(command: string, pattern: string) {
    return { command, versionArgs: ["--version"], probeArgs: ["auth"], successPattern: pattern };
  }

  it("passes when the pattern matches stdout", async () => {
    const execute = buildExecuteMock({
      "claude-ok": { version: okResult(), probe: okResult({ stdout: '{"loggedIn": true}' }) },
      "codex-ok": { version: okResult(), probe: okResult() },
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": configWithPattern("claude-ok", '"loggedIn":\\s*true'),
        codex: passingConfig("codex-ok"),
        cursor: passingConfig("cursor-unused"),
      } as never,
      makeLogger(),
    );

    const result = await health.runPreflight();
    expect(result.results.find((r) => r.runtime === "claude-code")?.authCheck.ok).toBe(true);
  });

  it("fails with an explanatory error when the pattern does not match", async () => {
    const execute = buildExecuteMock({
      "claude-nomatch": { version: okResult(), probe: okResult({ stdout: '{"loggedIn": false}' }) },
      "codex-ok": { version: okResult(), probe: okResult() },
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": configWithPattern("claude-nomatch", '"loggedIn":\\s*true'),
        codex: passingConfig("codex-ok"),
        cursor: passingConfig("cursor-unused"),
      } as never,
      makeLogger(),
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claude = health.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toMatch(/expected pattern not found/);
  });
});

describe("RuntimeHealthCheck.runPreflight — auth check branches (exitCodeOnly)", () => {
  function configExitCodeOnly(command: string) {
    return { command, versionArgs: ["--version"], probeArgs: ["status"], exitCodeOnly: true };
  }

  it("passes on exit code 0 regardless of output", async () => {
    const execute = buildExecuteMock({
      "claude-ec0": { version: okResult(), probe: okResult({ exitCode: 0 }) },
      "codex-ok": { version: okResult(), probe: okResult() },
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": configExitCodeOnly("claude-ec0"),
        codex: passingConfig("codex-ok"),
        cursor: passingConfig("cursor-unused"),
      } as never,
      makeLogger(),
    );

    const result = await health.runPreflight();
    expect(result.results.find((r) => r.runtime === "claude-code")?.authCheck.ok).toBe(true);
  });

  it("fails on a non-zero exit code, preferring stderr over stdout in the error", async () => {
    const execute = buildExecuteMock({
      "claude-ec1": {
        version: okResult(),
        probe: okResult({ exitCode: 2, stderr: "not logged in", stdout: "ignored" }),
      },
      "codex-ok": { version: okResult(), probe: okResult() },
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": configExitCodeOnly("claude-ec1"),
        codex: passingConfig("codex-ok"),
        cursor: passingConfig("cursor-unused"),
      } as never,
      makeLogger(),
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claude = health.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toBe("Exit code 2: not logged in");
  });
});

describe("RuntimeHealthCheck.runPreflight — auth check branches (default PONG detection)", () => {
  function defaultConfig(command: string) {
    return { command, versionArgs: ["--version"], probeArgs: ["exec"], probeStdin: "ping" };
  }

  it("passes when exit code is 0 and output contains PONG", async () => {
    const execute = buildExecuteMock({
      "claude-pong": { version: okResult(), probe: okResult({ exitCode: 0, stdout: "PONG" }) },
      "codex-ok": { version: okResult(), probe: okResult() },
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": defaultConfig("claude-pong"),
        codex: passingConfig("codex-ok"),
        cursor: passingConfig("cursor-unused"),
      } as never,
      makeLogger(),
    );

    const result = await health.runPreflight();
    expect(result.results.find((r) => r.runtime === "claude-code")?.authCheck.ok).toBe(true);
  });

  it("still passes on a non-zero exit code as long as PONG is present (case-insensitive)", async () => {
    const execute = buildExecuteMock({
      "claude-pong-badexit": {
        version: okResult(),
        probe: okResult({ exitCode: 1, stdout: "pong" }),
      },
      "codex-ok": { version: okResult(), probe: okResult() },
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": defaultConfig("claude-pong-badexit"),
        codex: passingConfig("codex-ok"),
        cursor: passingConfig("cursor-unused"),
      } as never,
      makeLogger(),
    );

    const result = await health.runPreflight();
    expect(result.results.find((r) => r.runtime === "claude-code")?.authCheck.ok).toBe(true);
  });

  it("fails on a non-zero exit code with no PONG, using stderr in the error", async () => {
    const execute = buildExecuteMock({
      "claude-nopong-badexit": {
        version: okResult(),
        probe: okResult({ exitCode: 1, stderr: "connection refused" }),
      },
      "codex-ok": { version: okResult(), probe: okResult() },
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": defaultConfig("claude-nopong-badexit"),
        codex: passingConfig("codex-ok"),
        cursor: passingConfig("cursor-unused"),
      } as never,
      makeLogger(),
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claude = health.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toBe("Exit code 1: connection refused");
  });

  it("fails on exit code 0 with no PONG in the output", async () => {
    const execute = buildExecuteMock({
      "claude-nopong-ok": { version: okResult(), probe: okResult({ exitCode: 0, stdout: "hello" }) },
      "codex-ok": { version: okResult(), probe: okResult() },
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": defaultConfig("claude-nopong-ok"),
        codex: passingConfig("codex-ok"),
        cursor: passingConfig("cursor-unused"),
      } as never,
      makeLogger(),
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claude = health.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toMatch(/did not return expected response/);
  });

  it("reports a timeout on the auth probe", async () => {
    const execute = buildExecuteMock({
      "claude-authtimeout": { version: okResult(), probe: okResult({ timedOut: true }) },
      "codex-ok": { version: okResult(), probe: okResult() },
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": defaultConfig("claude-authtimeout"),
        codex: passingConfig("codex-ok"),
        cursor: passingConfig("cursor-unused"),
      } as never,
      makeLogger(),
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claude = health.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toMatch(/Auth probe timed out after/);
  });

  it("catches a thrown error from the auth probe and reports its message", async () => {
    const execute = buildExecuteMock({
      "claude-auththrows": { version: okResult(), probe: new Error("socket hang up") },
      "codex-ok": { version: okResult(), probe: okResult() },
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": defaultConfig("claude-auththrows"),
        codex: passingConfig("codex-ok"),
        cursor: passingConfig("cursor-unused"),
      } as never,
      makeLogger(),
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const claude = health.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toBe("socket hang up");
  });
});

describe("PreflightError", () => {
  it("summarizes the failing runtimes in its message and carries the full result", async () => {
    const execute = buildExecuteMock({
      "claude-fail": { version: okResult({ exitCode: 1 }), probe: okResult() },
      "codex-ok": { version: okResult(), probe: okResult() },
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      {
        "claude-code": passingConfig("claude-fail"),
        codex: passingConfig("codex-ok"),
        cursor: passingConfig("cursor-unused"),
      } as never,
      makeLogger(),
    );

    let caught: unknown;
    try {
      await health.runPreflight();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PreflightError);
    const err = caught as PreflightError;
    expect(err.message).toContain("claude-code");
    expect(err.result.ok).toBe(false);
  });
});
