import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import type { ProcessResult, ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";
import { PreflightError } from "../../src/utils/errors.js";

function makeMockLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 10,
    timedOut: false,
    ...overrides,
  };
}

const CLAUDE_CMD = "claude-cmd";
const CODEX_CMD = "codex-cmd";
const CURSOR_CMD = "cursor-cmd";

function buildConfigs() {
  return RuntimeHealthCheck.buildRuntimeConfigs(
    CLAUDE_CMD,
    ["--print"],
    CODEX_CMD,
    ["exec", "-"],
    CURSOR_CMD,
  );
}

describe("RuntimeHealthCheck.buildRuntimeConfigs()", () => {
  it("builds the expected per-runtime probe configuration", () => {
    const configs = buildConfigs();

    expect(configs["claude-code"]).toEqual({
      command: CLAUDE_CMD,
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });
    expect(configs.codex).toEqual({
      command: CODEX_CMD,
      versionArgs: ["--version"],
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });
    expect(configs.cursor).toEqual({
      command: CURSOR_CMD,
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes()", () => {
  it("returns exactly the runtimes referenced by AGENT_STAGES (cursor is never required)", () => {
    const processRunner = { execute: vi.fn() };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      makeMockLogger() as never,
    );

    const required = check.getRequiredRuntimes();
    expect(required).toEqual(new Set(["claude-code", "codex"]));
    expect(required.has("cursor")).toBe(false);
  });
});

describe("RuntimeHealthCheck.getLastResult()", () => {
  it("is undefined before runPreflight() has ever run", () => {
    const processRunner = { execute: vi.fn() };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      makeMockLogger() as never,
    );
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight() — happy path", () => {
  it("resolves ok:true, lists skipped runtimes, and stores the result for getLastResult()", async () => {
    const execute = vi.fn(async (options: ProcessSpawnOptions) => {
      if (options.args[0] === "--version") {
        return makeResult({ stdout: "1.0.0\n" });
      }
      if (options.command === CLAUDE_CMD) {
        return makeResult({ stdout: '{"loggedIn": true}' });
      }
      // codex auth probe: PONG style
      return makeResult({ stdout: "PONG" });
    });
    const processRunner = { execute };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      logger as never,
    );

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(typeof result.totalDurationMs).toBe("number");
    expect(check.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });
});

describe("RuntimeHealthCheck.runPreflight() — failure path", () => {
  it("throws PreflightError with the full result attached and still stores it via getLastResult()", async () => {
    const execute = vi.fn(async (options: ProcessSpawnOptions) => {
      if (options.args[0] === "--version") {
        if (options.command === CODEX_CMD) {
          return makeResult({ exitCode: 127, stderr: "codex: command not found" });
        }
        return makeResult({ stdout: "1.0.0\n" });
      }
      return makeResult({ stdout: '{"loggedIn": true}' });
    });
    const processRunner = { execute };
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      logger as never,
    );

    const error = await check.runPreflight().catch((e) => e);

    expect(error).toBeInstanceOf(PreflightError);
    expect(error.result.ok).toBe(false);
    expect(error.message).toContain("codex");
    expect(check.getLastResult()).toBe(error.result);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: [
          expect.objectContaining({ runtime: "codex" }),
        ],
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("skips the auth probe entirely when the binary check fails (execute called once per failing runtime)", async () => {
    const execute = vi.fn(async (options: ProcessSpawnOptions) => {
      if (options.command === CLAUDE_CMD && options.args[0] === "--version") {
        return makeResult({ exitCode: 1, stderr: "not found" });
      }
      if (options.args[0] === "--version") return makeResult({ stdout: "1.0.0\n" });
      return makeResult({ stdout: "PONG" });
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs(),
      makeMockLogger() as never,
    );

    const error: PreflightError = await check.runPreflight().catch((e) => e);
    const claudeResult = error.result.results.find((r: { runtime: string }) => r.runtime === "claude-code");

    expect(claudeResult.binaryCheck.ok).toBe(false);
    expect(claudeResult.authCheck).toEqual({
      ok: false,
      durationMs: 0,
      error: "Skipped: binary check failed",
    });

    const claudeCalls = execute.mock.calls.filter(
      ([opts]: [ProcessSpawnOptions]) => opts.command === CLAUDE_CMD,
    );
    expect(claudeCalls).toHaveLength(1);
  });
});

describe("RuntimeHealthCheck binary check (checkBinary, via runPreflight)", () => {
  function singleRuntimeCheck(executeImpl: (o: ProcessSpawnOptions) => Promise<ProcessResult>) {
    const processRunner = { execute: vi.fn(executeImpl) };
    const configs = buildConfigs();
    // Force only claude-code to be probed isn't possible without AGENT_STAGES,
    // but claude-code is always required, so inspecting its entry is enough.
    return new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
  }

  async function claudeEntry(check: RuntimeHealthCheck) {
    const result = await check.runPreflight().catch((e) => e.result);
    return result.results.find((r: { runtime: string }) => r.runtime === "claude-code");
  }

  it("reports ok:true with a trimmed version string on success", async () => {
    const check = singleRuntimeCheck(async (o) =>
      o.args[0] === "--version"
        ? makeResult({ stdout: "v2.3.4 extra garbage after newline\nsecond line" })
        : makeResult({ stdout: '{"loggedIn": true}' }),
    );
    const entry = await claudeEntry(check);
    expect(entry.binaryCheck.ok).toBe(true);
    expect(entry.binaryCheck.version).toBe("v2.3.4 extra garbage after newline");
  });

  it("reports ok:false with a timeout message when the version probe times out", async () => {
    const check = singleRuntimeCheck(async (o) =>
      o.args[0] === "--version" ? makeResult({ timedOut: true }) : makeResult({ stdout: "PONG" }),
    );
    const entry = await claudeEntry(check);
    expect(entry.binaryCheck.ok).toBe(false);
    expect(entry.binaryCheck.error).toBe("Timed out after 5000ms");
  });

  it("reports ok:false with exit code and truncated stderr on non-zero exit", async () => {
    const check = singleRuntimeCheck(async (o) =>
      o.args[0] === "--version"
        ? makeResult({ exitCode: 127, stderr: "x".repeat(300) })
        : makeResult({ stdout: "PONG" }),
    );
    const entry = await claudeEntry(check);
    expect(entry.binaryCheck.ok).toBe(false);
    expect(entry.binaryCheck.error.startsWith("Exit code 127: ")).toBe(true);
    expect(entry.binaryCheck.error.length).toBeLessThanOrEqual("Exit code 127: ".length + 200);
  });

  it("reports ok:false with the error message when execute() rejects (e.g. spawn ENOENT)", async () => {
    const check = singleRuntimeCheck(async (o) => {
      if (o.args[0] === "--version") throw new Error("spawn claude-cmd ENOENT");
      return makeResult({ stdout: "PONG" });
    });
    const entry = await claudeEntry(check);
    expect(entry.binaryCheck.ok).toBe(false);
    expect(entry.binaryCheck.error).toBe("spawn claude-cmd ENOENT");
  });

  it("stringifies a non-Error rejection", async () => {
    const check = singleRuntimeCheck(async (o) => {
      if (o.args[0] === "--version") throw "raw string failure";
      return makeResult({ stdout: "PONG" });
    });
    const entry = await claudeEntry(check);
    expect(entry.binaryCheck.ok).toBe(false);
    expect(entry.binaryCheck.error).toBe("raw string failure");
  });
});

describe("RuntimeHealthCheck auth check (checkAuth, via runPreflight)", () => {
  function checkWith(executeImpl: (o: ProcessSpawnOptions) => Promise<ProcessResult>) {
    const processRunner = { execute: vi.fn(executeImpl) };
    return new RuntimeHealthCheck(processRunner as never, buildConfigs(), makeMockLogger() as never);
  }

  async function entryFor(check: RuntimeHealthCheck, runtime: string) {
    const result = await check.runPreflight().catch((e) => e.result);
    return result.results.find((r: { runtime: string }) => r.runtime === runtime);
  }

  it("successPattern config (claude-code): passes when the pattern matches stdout", async () => {
    const check = checkWith(async (o) =>
      o.args[0] === "--version" ? makeResult({ stdout: "1.0\n" }) : makeResult({ stdout: '{"loggedIn":true}' }),
    );
    const entry = await entryFor(check, "claude-code");
    expect(entry.authCheck).toEqual({ ok: true, durationMs: expect.any(Number) });
  });

  it("successPattern config (claude-code): fails with the stdout snippet when the pattern does not match", async () => {
    const check = checkWith(async (o) =>
      o.args[0] === "--version"
        ? makeResult({ stdout: "1.0\n" })
        : makeResult({ stdout: '{"loggedIn":false}' }),
    );
    const entry = await entryFor(check, "claude-code");
    expect(entry.authCheck.ok).toBe(false);
    expect(entry.authCheck.error).toContain("expected pattern not found");
    expect(entry.authCheck.error).toContain('{"loggedIn":false}');
  });

  it("times out the auth probe independently from the version probe", async () => {
    const check = checkWith(async (o) =>
      o.args[0] === "--version" ? makeResult({ stdout: "1.0\n" }) : makeResult({ timedOut: true }),
    );
    const entry = await entryFor(check, "claude-code");
    expect(entry.authCheck.ok).toBe(false);
    expect(entry.authCheck.error).toBe("Auth probe timed out after 30000ms");
  });

  it("codex (pong-based): passes when exitCode is 0 and output contains PONG", async () => {
    const check = checkWith(async (o) =>
      o.command === CODEX_CMD && o.args[0] !== "--version"
        ? makeResult({ stdout: "PONG", exitCode: 0 })
        : makeResult({ stdout: '{"loggedIn":true}' }),
    );
    const entry = await entryFor(check, "codex");
    expect(entry.authCheck).toEqual({ ok: true, durationMs: expect.any(Number) });
  });

  it("codex (pong-based): fails with an exit-code message when exitCode != 0 and no PONG is present", async () => {
    const check = checkWith(async (o) => {
      if (o.command === CODEX_CMD && o.args[0] !== "--version") {
        return makeResult({ stdout: "garbage", stderr: "internal error", exitCode: 1 });
      }
      return makeResult({ stdout: '{"loggedIn":true}' });
    });
    const entry = await entryFor(check, "codex");
    expect(entry.authCheck.ok).toBe(false);
    expect(entry.authCheck.error).toBe("Exit code 1: internal error");
  });

  it("codex (pong-based): fails with an 'unexpected response' message when exitCode is 0 but no PONG is present", async () => {
    const check = checkWith(async (o) => {
      if (o.command === CODEX_CMD && o.args[0] !== "--version") {
        return makeResult({ stdout: "not the right reply", exitCode: 0 });
      }
      return makeResult({ stdout: '{"loggedIn":true}' });
    });
    const entry = await entryFor(check, "codex");
    expect(entry.authCheck.ok).toBe(false);
    expect(entry.authCheck.error).toContain("did not return expected response");
  });

  it("codex (pong-based): passes even with a non-zero exit code, as long as PONG is present (boundary case)", async () => {
    const check = checkWith(async (o) => {
      if (o.command === CODEX_CMD && o.args[0] !== "--version") {
        return makeResult({ stdout: "trailing noise PONG after error", exitCode: 1 });
      }
      return makeResult({ stdout: '{"loggedIn":true}' });
    });
    const entry = await entryFor(check, "codex");
    expect(entry.authCheck).toEqual({ ok: true, durationMs: expect.any(Number) });
  });

  it("rejects (e.g. spawn ENOENT) during the auth probe are reported as ok:false with the error message", async () => {
    const check = checkWith(async (o) => {
      if (o.args[0] === "--version") return makeResult({ stdout: "1.0\n" });
      throw new Error("spawn boom ENOENT");
    });
    const entry = await entryFor(check, "claude-code");
    expect(entry.authCheck.ok).toBe(false);
    expect(entry.authCheck.error).toBe("spawn boom ENOENT");
  });

  it("stringifies a non-Error rejection from the auth probe", async () => {
    const check = checkWith(async (o) => {
      if (o.args[0] === "--version") return makeResult({ stdout: "1.0\n" });
      throw "raw auth failure";
    });
    const entry = await entryFor(check, "claude-code");
    expect(entry.authCheck.ok).toBe(false);
    expect(entry.authCheck.error).toBe("raw auth failure");
  });
});

describe("RuntimeHealthCheck — exitCodeOnly branch (direct unit coverage via cursor-shaped config)", () => {
  // cursor is never a required runtime, so to exercise the exitCodeOnly
  // branch of checkAuth we build a config map where claude-code (which IS
  // required) is given an exitCodeOnly probe config, mirroring cursor's
  // shape from buildRuntimeConfigs.
  function checkWithExitCodeOnlyClaude(
    executeImpl: (o: ProcessSpawnOptions) => Promise<ProcessResult>,
  ) {
    const configs = buildConfigs();
    configs["claude-code"] = {
      command: CLAUDE_CMD,
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    };
    const processRunner = { execute: vi.fn(executeImpl) };
    return new RuntimeHealthCheck(processRunner as never, configs, makeMockLogger() as never);
  }

  async function claudeEntry(check: RuntimeHealthCheck) {
    const result = await check.runPreflight().catch((e) => e.result);
    return result.results.find((r: { runtime: string }) => r.runtime === "claude-code");
  }

  it("passes when exitCode is 0", async () => {
    const check = checkWithExitCodeOnlyClaude(async (o) =>
      o.args[0] === "--version" ? makeResult({ stdout: "1.0\n" }) : makeResult({ exitCode: 0 }),
    );
    const entry = await claudeEntry(check);
    expect(entry.authCheck).toEqual({ ok: true, durationMs: expect.any(Number) });
  });

  it("fails with an exit-code message (using stderr) when exitCode != 0", async () => {
    const check = checkWithExitCodeOnlyClaude(async (o) =>
      o.args[0] === "--version"
        ? makeResult({ stdout: "1.0\n" })
        : makeResult({ exitCode: 3, stderr: "not logged in" }),
    );
    const entry = await claudeEntry(check);
    expect(entry.authCheck.ok).toBe(false);
    expect(entry.authCheck.error).toBe("Exit code 3: not logged in");
  });

  it("falls back to stdout for the error message when stderr is empty", async () => {
    const check = checkWithExitCodeOnlyClaude(async (o) =>
      o.args[0] === "--version"
        ? makeResult({ stdout: "1.0\n" })
        : makeResult({ exitCode: 3, stdout: "status: unauthenticated", stderr: "" }),
    );
    const entry = await claudeEntry(check);
    expect(entry.authCheck.ok).toBe(false);
    expect(entry.authCheck.error).toBe("Exit code 3: status: unauthenticated");
  });
});
