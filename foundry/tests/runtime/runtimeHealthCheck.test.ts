import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function okResult(stdout: string, overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout, stderr: "", exitCode: 0, durationMs: 5, timedOut: false, ...overrides };
}

// AGENT_STAGES only references "claude-code" and "codex" runtimes, so
// getRequiredRuntimes()/runPreflight() always probe exactly those two.
// We fully control the RuntimeConfig assigned to each key so every branch
// of checkBinary/checkAuth can be exercised through the public API.
function buildConfigs(overrides: {
  claudeCode?: Record<string, unknown>;
  codex?: Record<string, unknown>;
}) {
  return {
    "claude-code": {
      command: "claude",
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
      ...overrides.claudeCode,
    },
    codex: {
      command: "codex",
      versionArgs: ["--version"],
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
      ...overrides.codex,
    },
    // cursor is never required by AGENT_STAGES but the Record type demands an entry.
    cursor: {
      command: "agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    },
  };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs()", () => {
  it("builds the expected static config shape for all three runtimes", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      [],
      "codex",
      ["exec", "-"],
      "agent",
    );

    expect(configs["claude-code"]).toMatchObject({
      command: "claude",
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });
    expect(configs.codex).toMatchObject({
      command: "codex",
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });
    expect(configs.cursor).toMatchObject({
      command: "agent",
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes()", () => {
  it("returns exactly claude-code and codex (the runtimes referenced by AGENT_STAGES)", () => {
    const processRunner = { execute: vi.fn() };
    const health = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs({}) as never,
      makeLogger() as never,
    );

    const required = health.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
    expect(required.size).toBe(2);
  });
});

describe("RuntimeHealthCheck.getLastResult()", () => {
  it("is undefined before runPreflight() has ever run", () => {
    const processRunner = { execute: vi.fn() };
    const health = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs({}) as never,
      makeLogger() as never,
    );
    expect(health.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight() — success path", () => {
  it("resolves ok:true when both binary and auth checks pass for all required runtimes", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) {
        return okResult(`${opts.command} v1.2.3\n`);
      }
      if (opts.command === "claude") {
        return okResult('{"loggedIn": true}');
      }
      // codex probe: pong echo
      return okResult("PONG");
    });
    const processRunner = { execute };
    const logger = makeLogger();
    const health = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs({}) as never,
      logger as never,
    );

    const result = await health.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(typeof result.totalDurationMs).toBe("number");
    expect(health.getLastResult()).toBe(result);
    expect(logger.error).not.toHaveBeenCalled();

    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.ok).toBe(true);
    expect(claudeResult.binaryCheck.version).toBe("claude v1.2.3");
    expect(claudeResult.authCheck.ok).toBe(true);

    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.binaryCheck.ok).toBe(true);
    expect(codexResult.authCheck.ok).toBe(true);
  });
});

describe("RuntimeHealthCheck.runPreflight() — failure paths", () => {
  it("throws PreflightError and records ok:false when a binary check fails (skips the auth check)", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args.includes("--version")) {
        return okResult("", { exitCode: 127, stderr: "command not found" });
      }
      if (opts.args.includes("--version")) {
        return okResult("codex v1.0.0");
      }
      return okResult("PONG");
    });
    const processRunner = { execute };
    const logger = makeLogger();
    const health = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs({}) as never,
      logger as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    expect(logger.error).toHaveBeenCalledOnce();

    const result = health.getLastResult()!;
    expect(result.ok).toBe(false);
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.ok).toBe(false);
    expect(claudeResult.binaryCheck.error).toContain("Exit code 127");
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toBe("Skipped: binary check failed");
  });

  it("throws PreflightError with the failing runtimes listed in the error message", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return okResult("v1");
      if (opts.command === "claude") return okResult('{"loggedIn": false}'); // pattern won't match
      return okResult("PONG");
    });
    const processRunner = { execute };
    const health = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs({}) as never,
      makeLogger() as never,
    );

    try {
      await health.runPreflight();
      expect.unreachable("expected runPreflight to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightError);
      const preflightErr = err as PreflightError;
      expect(preflightErr.message).toContain("claude-code");
      expect(preflightErr.result.ok).toBe(false);
    }
  });

  it("auth check fails when successPattern does not match stdout/stderr", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return okResult("v1");
      if (opts.command === "claude") return okResult('{"loggedIn": false}');
      return okResult("PONG");
    });
    const processRunner = { execute };
    const health = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs({}) as never,
      makeLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const result = health.getLastResult()!;
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toContain("expected pattern not found");
  });

  it("version-check timeout produces a descriptive binaryCheck failure", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) {
        return { stdout: "", stderr: "", exitCode: 1, durationMs: 5000, timedOut: true };
      }
      return okResult("PONG");
    });
    const processRunner = { execute };
    const health = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs({}) as never,
      makeLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const result = health.getLastResult()!;
    for (const r of result.results) {
      expect(r.binaryCheck.ok).toBe(false);
      expect(r.binaryCheck.error).toContain("Timed out after");
    }
  });

  it("auth-probe timeout produces a descriptive authCheck failure", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return okResult("v1");
      return { stdout: "", stderr: "", exitCode: 0, durationMs: 30000, timedOut: true };
    });
    const processRunner = { execute };
    const health = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs({}) as never,
      makeLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const result = health.getLastResult()!;
    for (const r of result.results) {
      expect(r.authCheck.ok).toBe(false);
      expect(r.authCheck.error).toContain("timed out after");
    }
  });

  it("binaryCheck catches a thrown error from processRunner.execute()", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) {
        throw new Error("spawn ENOENT");
      }
      return okResult("PONG");
    });
    const processRunner = { execute };
    const health = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs({}) as never,
      makeLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const result = health.getLastResult()!;
    for (const r of result.results) {
      expect(r.binaryCheck.ok).toBe(false);
      expect(r.binaryCheck.error).toBe("spawn ENOENT");
    }
  });

  it("authCheck catches a thrown error from processRunner.execute()", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return okResult("v1");
      throw new Error("boom during auth probe");
    });
    const processRunner = { execute };
    const health = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs({}) as never,
      makeLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const result = health.getLastResult()!;
    for (const r of result.results) {
      expect(r.authCheck.ok).toBe(false);
      expect(r.authCheck.error).toBe("boom during auth probe");
    }
  });

  it("stringifies a non-Error value thrown from binaryCheck's execute()", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "raw string failure";
      }
      return okResult("PONG");
    });
    const processRunner = { execute };
    const health = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs({}) as never,
      makeLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const result = health.getLastResult()!;
    for (const r of result.results) {
      expect(r.binaryCheck.error).toBe("raw string failure");
    }
  });

  it("stringifies a non-Error value thrown from checkAuth's execute()", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return okResult("v1");
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "raw auth failure";
    });
    const processRunner = { execute };
    const health = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs({}) as never,
      makeLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const result = health.getLastResult()!;
    for (const r of result.results) {
      expect(r.authCheck.error).toBe("raw auth failure");
    }
  });
});

describe("RuntimeHealthCheck — exitCodeOnly auth strategy", () => {
  it("passes when exitCodeOnly and exit code is 0, regardless of output content", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return okResult("v1");
      if (opts.command === "claude") return okResult("irrelevant output");
      return okResult("PONG");
    });
    const processRunner = { execute };
    const health = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs({ claudeCode: { successPattern: undefined, exitCodeOnly: true } }) as never,
      makeLogger() as never,
    );

    const result = await health.runPreflight();
    expect(result.ok).toBe(true);
  });

  it("fails when exitCodeOnly and exit code is non-zero with empty stderr, falling back to stdout in the error", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return okResult("v1");
      if (opts.command === "claude") {
        return okResult("stdout explains the failure", { exitCode: 2, stderr: "" });
      }
      return okResult("PONG");
    });
    const processRunner = { execute };
    const health = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs({ claudeCode: { successPattern: undefined, exitCodeOnly: true } }) as never,
      makeLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const result = health.getLastResult()!;
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.error).toContain("stdout explains the failure");
  });

  it("fails when exitCodeOnly and exit code is non-zero, surfacing stderr in the error", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return okResult("v1");
      if (opts.command === "claude") {
        return okResult("", { exitCode: 3, stderr: "not logged in" });
      }
      return okResult("PONG");
    });
    const processRunner = { execute };
    const health = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs({ claudeCode: { successPattern: undefined, exitCodeOnly: true } }) as never,
      makeLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const result = health.getLastResult()!;
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.authCheck.ok).toBe(false);
    expect(claudeResult.authCheck.error).toContain("Exit code 3");
    expect(claudeResult.authCheck.error).toContain("not logged in");
  });
});

describe("RuntimeHealthCheck — default pong-detection auth strategy", () => {
  it("passes when exit code is non-zero but output still contains 'pong' (case-insensitive)", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return okResult("v1");
      if (opts.command === "codex") {
        return okResult("", { exitCode: 1, stdout: "warning\nPong", stderr: "" });
      }
      return okResult('{"loggedIn": true}');
    });
    const processRunner = { execute };
    const health = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs({}) as never,
      makeLogger() as never,
    );

    const result = await health.runPreflight();
    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("fails when exit code is non-zero and output does not contain 'pong'", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return okResult("v1");
      if (opts.command === "codex") {
        return okResult("", { exitCode: 1, stdout: "", stderr: "auth failed" });
      }
      return okResult('{"loggedIn": true}');
    });
    const processRunner = { execute };
    const health = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs({}) as never,
      makeLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const result = health.getLastResult()!;
    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(false);
    expect(codexResult.authCheck.error).toContain("Exit code 1");
  });

  it("fails when exit code is 0 but output does not contain 'pong' (unexpected response)", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) return okResult("v1");
      if (opts.command === "codex") {
        return okResult("unexpected text with no marker");
      }
      return okResult('{"loggedIn": true}');
    });
    const processRunner = { execute };
    const health = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs({}) as never,
      makeLogger() as never,
    );

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);
    const result = health.getLastResult()!;
    const codexResult = result.results.find((r) => r.runtime === "codex")!;
    expect(codexResult.authCheck.ok).toBe(false);
    expect(codexResult.authCheck.error).toContain("did not return expected response");
  });
});

describe("RuntimeHealthCheck — binary version parsing", () => {
  it("takes only the first line of stdout and truncates it to 100 characters", async () => {
    const longVersion = "v" + "9".repeat(150);
    const execute = vi.fn().mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) {
        return okResult(`${longVersion}\nextra ignored line\n`);
      }
      return okResult("PONG");
    });
    const processRunner = { execute };
    const health = new RuntimeHealthCheck(
      processRunner as never,
      buildConfigs({ claudeCode: { successPattern: undefined, exitCodeOnly: true } }) as never,
      makeLogger() as never,
    );

    const result = await health.runPreflight();
    const claudeResult = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeResult.binaryCheck.version).toHaveLength(100);
    expect(claudeResult.binaryCheck.version).not.toContain("extra ignored line");
  });
});
