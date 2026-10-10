import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import type { ProcessResult, ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";
import { PreflightError } from "../../src/utils/errors.js";
import { AGENT_STAGES } from "../../src/domain/types.js";

function makeMockProcessRunner() {
  return { execute: vi.fn() };
}

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function okResult(stdout: string, overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    stdout,
    stderr: "",
    exitCode: 0,
    durationMs: 10,
    timedOut: false,
    ...overrides,
  };
}

const CONFIGS = RuntimeHealthCheck.buildRuntimeConfigs(
  "claude",
  ["--print", "--output-format", "json"],
  "codex",
  ["exec", "-"],
  "cursor",
);

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds configs with the expected shape for all three runtimes", () => {
    expect(CONFIGS["claude-code"]).toMatchObject({
      command: "claude",
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });
    expect(CONFIGS.codex).toMatchObject({
      command: "codex",
      versionArgs: ["--version"],
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });
    expect(CONFIGS.cursor).toMatchObject({
      command: "cursor",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes", () => {
  it("reflects the distinct runtimes used across AGENT_STAGES", () => {
    const processRunner = makeMockProcessRunner();
    const logger = makeMockLogger();
    const health = new RuntimeHealthCheck(processRunner as never, CONFIGS, logger as never);

    const required = health.getRequiredRuntimes();

    const expected = new Set(Object.values(AGENT_STAGES).map((s) => s.runtime));
    expect(required).toEqual(expected);
    // Sanity: AGENT_STAGES actually uses claude-code and codex (not cursor).
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });
});

describe("RuntimeHealthCheck.getLastResult", () => {
  it("returns undefined before runPreflight has ever run", () => {
    const processRunner = makeMockProcessRunner();
    const logger = makeMockLogger();
    const health = new RuntimeHealthCheck(processRunner as never, CONFIGS, logger as never);

    expect(health.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight — success path", () => {
  it("resolves ok:true, sets getLastResult(), and logs an info success message", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") {
        return Promise.resolve(okResult("v1.2.3\n"));
      }
      if (opts.command === "claude") {
        return Promise.resolve(okResult('{"loggedIn": true}'));
      }
      // codex pong probe
      return Promise.resolve(okResult("PONG"));
    });
    const logger = makeMockLogger();
    const health = new RuntimeHealthCheck(processRunner as never, CONFIGS, logger as never);

    const result = await health.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"].sort());
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    for (const r of result.results) {
      expect(r.binaryCheck.ok).toBe(true);
      expect(r.authCheck.ok).toBe(true);
    }
    expect(health.getLastResult()).toBe(result);

    const infoCalls = logger.info.mock.calls;
    const successCall = infoCalls.find(
      (c) => c[1] === "Preflight passed: all agent runtimes are accessible and authenticated",
    );
    expect(successCall).toBeDefined();
    expect(successCall![0]).toMatchObject({ runtimes: expect.arrayContaining(["claude-code", "codex"]) });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("parses the binary version from the first line of stdout only", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") {
        return Promise.resolve(okResult("2.0.0\nextra ignored line\n"));
      }
      if (opts.command === "claude") {
        return Promise.resolve(okResult('{"loggedIn": true}'));
      }
      return Promise.resolve(okResult("PONG"));
    });
    const logger = makeMockLogger();
    const health = new RuntimeHealthCheck(processRunner as never, CONFIGS, logger as never);

    const result = await health.runPreflight();

    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.version).toBe("2.0.0");
  });
});

describe("RuntimeHealthCheck.runPreflight — failure path", () => {
  it("throws PreflightError with .result.results reflecting the failing runtime, and still sets getLastResult()", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") {
        return Promise.resolve(okResult("v1.0.0\n"));
      }
      if (opts.command === "claude") {
        // Auth check fails: pattern not found
        return Promise.resolve(okResult("not logged in"));
      }
      return Promise.resolve(okResult("PONG"));
    });
    const logger = makeMockLogger();
    const health = new RuntimeHealthCheck(processRunner as never, CONFIGS, logger as never);

    let thrown: unknown;
    try {
      await health.runPreflight();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(PreflightError);
    const preflightError = thrown as PreflightError;
    expect(preflightError.result.ok).toBe(false);
    const failingClaude = preflightError.result.results.find((r) => r.runtime === "claude-code")!;
    expect(failingClaude.binaryCheck.ok).toBe(true);
    expect(failingClaude.authCheck.ok).toBe(false);
    expect(failingClaude.authCheck.error).toContain("Auth check failed");

    expect(health.getLastResult()).toBeDefined();
    expect(health.getLastResult()!.ok).toBe(false);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ runtime: "claude-code" }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });
});

describe("RuntimeHealthCheck binary check branches", () => {
  function healthWithSingleRuntime() {
    const processRunner = makeMockProcessRunner();
    const logger = makeMockLogger();
    // Only claude-code config is exercised via direct probeRuntime-style calls,
    // routed through runPreflight with a configs map limited to one runtime
    // by making codex/cursor auto-pass so we can isolate claude-code's result.
    const health = new RuntimeHealthCheck(processRunner as never, CONFIGS, logger as never);
    return { processRunner, logger, health };
  }

  it("binary check ok: parses version from first stdout line on exit 0", async () => {
    const { processRunner, health } = healthWithSingleRuntime();
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version" && opts.command === "claude") {
        return Promise.resolve(okResult("9.9.9\n"));
      }
      if (opts.args[0] === "--version") return Promise.resolve(okResult("1.0.0"));
      if (opts.command === "claude") return Promise.resolve(okResult('{"loggedIn": true}'));
      return Promise.resolve(okResult("PONG"));
    });

    const result = await health.runPreflight();
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck).toMatchObject({ ok: true, version: "9.9.9" });
  });

  it("binary check timed out", async () => {
    const { processRunner, health } = healthWithSingleRuntime();
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version" && opts.command === "claude") {
        return Promise.resolve(okResult("", { timedOut: true, exitCode: 1 }));
      }
      if (opts.args[0] === "--version") return Promise.resolve(okResult("1.0.0"));
      return Promise.resolve(okResult("PONG"));
    });

    let thrown: unknown;
    try {
      await health.runPreflight();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PreflightError);
    const claude = (thrown as PreflightError).result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(false);
    expect(claude.binaryCheck.error).toBe("Timed out after 5000ms");
    // Auth check must be skipped without a second execute() call for this runtime.
    expect(claude.authCheck).toEqual({ ok: false, durationMs: 0, error: "Skipped: binary check failed" });
  });

  it("binary check non-zero exit code includes truncated stderr in the error", async () => {
    const { processRunner, health } = healthWithSingleRuntime();
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version" && opts.command === "claude") {
        return Promise.resolve(okResult("", { exitCode: 127, stderr: "command not found" }));
      }
      if (opts.args[0] === "--version") return Promise.resolve(okResult("1.0.0"));
      return Promise.resolve(okResult("PONG"));
    });

    let thrown: unknown;
    try {
      await health.runPreflight();
    } catch (err) {
      thrown = err;
    }
    const claude = (thrown as PreflightError).result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(false);
    expect(claude.binaryCheck.error).toBe("Exit code 127: command not found");
    expect(claude.authCheck.error).toBe("Skipped: binary check failed");
  });

  it("binary check execute() throwing is caught and reported as a failed check", async () => {
    const { processRunner, health } = healthWithSingleRuntime();
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version" && opts.command === "claude") {
        return Promise.reject(new Error("ENOENT: spawn claude"));
      }
      if (opts.args[0] === "--version") return Promise.resolve(okResult("1.0.0"));
      return Promise.resolve(okResult("PONG"));
    });

    let thrown: unknown;
    try {
      await health.runPreflight();
    } catch (err) {
      thrown = err;
    }
    const claude = (thrown as PreflightError).result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(false);
    expect(claude.binaryCheck.error).toBe("ENOENT: spawn claude");
  });

  it("binary check execute() throwing a non-Error value stringifies it", async () => {
    const { processRunner, health } = healthWithSingleRuntime();
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version" && opts.command === "claude") {
        return Promise.reject("plain string failure");
      }
      if (opts.args[0] === "--version") return Promise.resolve(okResult("1.0.0"));
      return Promise.resolve(okResult("PONG"));
    });

    let thrown: unknown;
    try {
      await health.runPreflight();
    } catch (err) {
      thrown = err;
    }
    const claude = (thrown as PreflightError).result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.error).toBe("plain string failure");
  });

  it("the binary-check-failed short-circuit never calls execute() a second time for auth on that runtime", async () => {
    const { processRunner, health } = healthWithSingleRuntime();
    let claudeExecuteCalls = 0;
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.command === "claude") {
        claudeExecuteCalls += 1;
        return Promise.resolve(okResult("", { exitCode: 1, stderr: "boom" }));
      }
      if (opts.args[0] === "--version") return Promise.resolve(okResult("1.0.0"));
      return Promise.resolve(okResult("PONG"));
    });

    await health.runPreflight().catch(() => undefined);

    // Only the binary (--version) check should have called execute for claude.
    expect(claudeExecuteCalls).toBe(1);
  });
});

describe("RuntimeHealthCheck auth check branches — successPattern (claude-code style)", () => {
  function setup() {
    const processRunner = makeMockProcessRunner();
    const logger = makeMockLogger();
    const health = new RuntimeHealthCheck(processRunner as never, CONFIGS, logger as never);
    return { processRunner, health };
  }

  it("matches successPattern against stdout and passes", async () => {
    const { processRunner, health } = setup();
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") return Promise.resolve(okResult("1.0.0"));
      if (opts.command === "claude") return Promise.resolve(okResult('{"loggedIn": true}'));
      return Promise.resolve(okResult("PONG"));
    });
    const result = await health.runPreflight();
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck).toEqual({ ok: true, durationMs: expect.any(Number) });
  });

  it("fails with a descriptive error when successPattern does not match stdout or stderr", async () => {
    const { processRunner, health } = setup();
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") return Promise.resolve(okResult("1.0.0"));
      if (opts.command === "claude") return Promise.resolve(okResult('{"loggedIn": false}'));
      return Promise.resolve(okResult("PONG"));
    });
    let thrown: unknown;
    try {
      await health.runPreflight();
    } catch (err) {
      thrown = err;
    }
    const claude = (thrown as PreflightError).result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toContain("expected pattern not found in output");
    expect(claude.authCheck.error).toContain('"loggedIn": false');
  });

  it("auth check timed out", async () => {
    const { processRunner, health } = setup();
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") return Promise.resolve(okResult("1.0.0"));
      if (opts.command === "claude") return Promise.resolve(okResult("", { timedOut: true }));
      return Promise.resolve(okResult("PONG"));
    });
    let thrown: unknown;
    try {
      await health.runPreflight();
    } catch (err) {
      thrown = err;
    }
    const claude = (thrown as PreflightError).result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toBe("Auth probe timed out after 30000ms");
  });

  it("auth check execute() throwing is caught", async () => {
    const { processRunner, health } = setup();
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") return Promise.resolve(okResult("1.0.0"));
      if (opts.command === "claude") return Promise.reject(new Error("socket hang up"));
      return Promise.resolve(okResult("PONG"));
    });
    let thrown: unknown;
    try {
      await health.runPreflight();
    } catch (err) {
      thrown = err;
    }
    const claude = (thrown as PreflightError).result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toBe("socket hang up");
  });

  it("auth check execute() throwing a non-Error value stringifies it", async () => {
    const { processRunner, health } = setup();
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") return Promise.resolve(okResult("1.0.0"));
      if (opts.command === "claude") return Promise.reject("raw string auth failure");
      return Promise.resolve(okResult("PONG"));
    });
    let thrown: unknown;
    try {
      await health.runPreflight();
    } catch (err) {
      thrown = err;
    }
    const claude = (thrown as PreflightError).result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toBe("raw string auth failure");
  });
});

describe("RuntimeHealthCheck auth check branches — exitCodeOnly (cursor style)", () => {
  // Cursor is not in AGENT_STAGES, so build a configs map requiring it directly
  // by constructing RuntimeHealthCheck with a custom runtimeConfigs/required set
  // via getRequiredRuntimes override isn't possible (not injectable), so we
  // exercise exitCodeOnly semantics directly through checkAuth-equivalent
  // behavior using the cursor config with a bespoke subclass-free approach:
  // call runPreflight after monkeypatching getRequiredRuntimes via a stage-less
  // trick is unnecessary — instead we validate exitCodeOnly success/failure by
  // using the cursor runtime through a configs map where cursor is required.
  function setupCursorRequired() {
    const processRunner = makeMockProcessRunner();
    const logger = makeMockLogger();
    // Build configs where ALL three runtimes behave like cursor's exitCodeOnly
    // auth style is not directly reachable via AGENT_STAGES (cursor is unused),
    // so instead we test exitCodeOnly behavior by crafting a fake AgentRuntime
    // config set where claude-code's config is swapped for an exitCodeOnly one.
    const configs = {
      "claude-code": {
        command: "claude",
        versionArgs: ["--version"],
        probeArgs: ["status"],
        exitCodeOnly: true,
      },
      codex: CONFIGS.codex,
      cursor: CONFIGS.cursor,
    };
    const health = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    return { processRunner, health };
  }

  it("passes when exitCodeOnly and exit code is 0, regardless of output content", async () => {
    const { processRunner, health } = setupCursorRequired();
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") return Promise.resolve(okResult("1.0.0"));
      if (opts.command === "claude") return Promise.resolve(okResult("anything goes here"));
      return Promise.resolve(okResult("PONG"));
    });
    const result = await health.runPreflight();
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck).toEqual({ ok: true, durationMs: expect.any(Number) });
  });

  it("fails when exitCodeOnly and exit code is non-zero, using stderr (or stdout fallback) in the error", async () => {
    const { processRunner, health } = setupCursorRequired();
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") return Promise.resolve(okResult("1.0.0"));
      if (opts.command === "claude") {
        return Promise.resolve(okResult("fallback stdout text", { exitCode: 3, stderr: "" }));
      }
      return Promise.resolve(okResult("PONG"));
    });
    let thrown: unknown;
    try {
      await health.runPreflight();
    } catch (err) {
      thrown = err;
    }
    const claude = (thrown as PreflightError).result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toBe("Exit code 3: fallback stdout text");
  });
});

describe("RuntimeHealthCheck auth check branches — pong fallback (codex style)", () => {
  it("exit 0 with pong in output passes", async () => {
    const processRunner = makeMockProcessRunner();
    const logger = makeMockLogger();
    const health = new RuntimeHealthCheck(processRunner as never, CONFIGS, logger as never);
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") return Promise.resolve(okResult("1.0.0"));
      if (opts.command === "claude") return Promise.resolve(okResult('{"loggedIn": true}'));
      return Promise.resolve(okResult("PONG"));
    });
    const result = await health.runPreflight();
    const codex = result.results.find((r) => r.runtime === "codex")!;
    expect(codex.authCheck).toEqual({ ok: true, durationMs: expect.any(Number) });
  });

  it("exit 0 without pong fails with 'did not return expected response'", async () => {
    const processRunner = makeMockProcessRunner();
    const logger = makeMockLogger();
    const health = new RuntimeHealthCheck(processRunner as never, CONFIGS, logger as never);
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") return Promise.resolve(okResult("1.0.0"));
      if (opts.command === "claude") return Promise.resolve(okResult('{"loggedIn": true}'));
      return Promise.resolve(okResult("something else entirely"));
    });
    let thrown: unknown;
    try {
      await health.runPreflight();
    } catch (err) {
      thrown = err;
    }
    const codex = (thrown as PreflightError).result.results.find((r) => r.runtime === "codex")!;
    expect(codex.authCheck.ok).toBe(false);
    expect(codex.authCheck.error).toContain("did not return expected response");
  });

  it("non-zero exit with pong present still passes (pong detection overrides exit code)", async () => {
    const processRunner = makeMockProcessRunner();
    const logger = makeMockLogger();
    const health = new RuntimeHealthCheck(processRunner as never, CONFIGS, logger as never);
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") return Promise.resolve(okResult("1.0.0"));
      if (opts.command === "claude") return Promise.resolve(okResult('{"loggedIn": true}'));
      return Promise.resolve(okResult("noisy stderr PONG trailer", { exitCode: 1 }));
    });
    const result = await health.runPreflight();
    const codex = result.results.find((r) => r.runtime === "codex")!;
    expect(codex.authCheck).toEqual({ ok: true, durationMs: expect.any(Number) });
  });

  it("non-zero exit without pong fails with the exit code and stderr", async () => {
    const processRunner = makeMockProcessRunner();
    const logger = makeMockLogger();
    const health = new RuntimeHealthCheck(processRunner as never, CONFIGS, logger as never);
    processRunner.execute.mockImplementation((opts: ProcessSpawnOptions) => {
      if (opts.args[0] === "--version") return Promise.resolve(okResult("1.0.0"));
      if (opts.command === "claude") return Promise.resolve(okResult('{"loggedIn": true}'));
      return Promise.resolve(okResult("", { exitCode: 2, stderr: "codex auth expired" }));
    });
    let thrown: unknown;
    try {
      await health.runPreflight();
    } catch (err) {
      thrown = err;
    }
    const codex = (thrown as PreflightError).result.results.find((r) => r.runtime === "codex")!;
    expect(codex.authCheck.ok).toBe(false);
    expect(codex.authCheck.error).toBe("Exit code 2: codex auth expired");
  });
});
