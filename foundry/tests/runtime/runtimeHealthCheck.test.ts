import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { AGENT_STAGES, type AgentRuntime } from "../../src/domain/types.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeMockProcessRunner() {
  return {
    execute: vi.fn(),
  };
}

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

function okResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 1,
    timedOut: false,
    ...overrides,
  };
}

const configs = {
  "claude-code": {
    command: "claude",
    versionArgs: ["--version"],
    probeArgs: ["auth", "status"],
    successPattern: '"loggedIn":\\s*true',
  },
  codex: {
    command: "codex",
    versionArgs: ["--version"],
    probeArgs: ["exec"],
    probeStdin: "Respond with exactly: PONG",
  },
  cursor: {
    command: "cursor-agent",
    versionArgs: ["--version"],
    probeArgs: ["status"],
    exitCodeOnly: true,
  },
};

describe("RuntimeHealthCheck.buildRuntimeConfigs()", () => {
  it("produces the right shape for each of the 3 runtimes", () => {
    const built = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--base"],
      "codex",
      ["exec"],
      "cursor-agent",
    );

    expect(built["claude-code"]).toEqual({
      command: "claude",
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });
    expect(built.codex).toEqual({
      command: "codex",
      versionArgs: ["--version"],
      probeArgs: ["exec"],
      probeStdin: "Respond with exactly: PONG",
    });
    expect(built.cursor).toEqual({
      command: "cursor-agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes()", () => {
  it("derives the set of runtimes from AGENT_STAGES", () => {
    const processRunner = makeMockProcessRunner();
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs as never, logger as never);

    const expected = new Set<AgentRuntime>(
      Object.values(AGENT_STAGES).map((stage) => stage.runtime),
    );

    expect(check.getRequiredRuntimes()).toEqual(expected);
  });
});

describe("RuntimeHealthCheck.getLastResult()", () => {
  it("is undefined before any run, and set after a run completes", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) {
        return okResult({ stdout: "v1.0.0\n" });
      }
      if (opts.command === "claude") {
        return okResult({ stdout: '{"loggedIn": true}\n' });
      }
      if (opts.command === "codex") {
        return okResult({ stdout: "PONG\n" });
      }
      return okResult({ exitCode: 0 });
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs as never, logger as never);

    expect(check.getLastResult()).toBeUndefined();

    await check.runPreflight();

    expect(check.getLastResult()).toBeDefined();
    expect(check.getLastResult()?.ok).toBe(true);
  });
});

describe("RuntimeHealthCheck.runPreflight()", () => {
  it("happy path: ok:true with no throw when all probes succeed", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) {
        return okResult({ stdout: "v1.0.0\n" });
      }
      if (opts.command === "claude") {
        return okResult({ stdout: '{"loggedIn": true}\n' });
      }
      if (opts.command === "codex") {
        return okResult({ stdout: "PONG\n" });
      }
      // cursor-agent status
      return okResult({ exitCode: 0 });
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs as never, logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(result.requiredRuntimes.length);
    for (const r of result.results) {
      expect(r.binaryCheck.ok).toBe(true);
      expect(r.authCheck.ok).toBe(true);
    }
  });

  it("failure path: throws PreflightError and sets lastResult.ok to false when a probe fails", async () => {
    const processRunner = makeMockProcessRunner();
    processRunner.execute.mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args.includes("--version")) {
        return okResult({ stdout: "v1.0.0\n" });
      }
      if (opts.command === "claude") {
        // auth probe fails: pattern not found
        return okResult({ stdout: "{}\n" });
      }
      if (opts.command === "codex") {
        return okResult({ stdout: "PONG\n" });
      }
      return okResult({ exitCode: 0 });
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs as never, logger as never);

    let thrown: unknown;
    try {
      await check.runPreflight();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(PreflightError);
    expect(check.getLastResult()?.ok).toBe(false);
  });
});

describe("RuntimeHealthCheck private probe behavior (via runPreflight with a single required runtime)", () => {
  function makeSingleRuntimeCheck(
    processRunner: ReturnType<typeof makeMockProcessRunner>,
    runtime: AgentRuntime,
  ) {
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs as never, logger as never);
    vi.spyOn(check, "getRequiredRuntimes").mockReturnValue(new Set([runtime]));
    return check;
  }

  describe("checkBinary", () => {
    it("timeout branch: result.timedOut true -> ok:false with timeout error", async () => {
      const processRunner = makeMockProcessRunner();
      processRunner.execute.mockResolvedValueOnce(okResult({ timedOut: true }));
      const check = makeSingleRuntimeCheck(processRunner, "cursor");

      await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
      const result = check.getLastResult()!;
      expect(result.results[0]!.binaryCheck.ok).toBe(false);
      expect(result.results[0]!.binaryCheck.error).toMatch(/Timed out after/);
    });

    it("non-zero exit code branch: ok:false with exit code and stderr in error", async () => {
      const processRunner = makeMockProcessRunner();
      processRunner.execute.mockResolvedValueOnce(
        okResult({ exitCode: 127, stderr: "command not found" }),
      );
      const check = makeSingleRuntimeCheck(processRunner, "cursor");

      await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
      const result = check.getLastResult()!;
      expect(result.results[0]!.binaryCheck.ok).toBe(false);
      expect(result.results[0]!.binaryCheck.error).toBe(
        "Exit code 127: command not found",
      );
    });

    it("thrown exception branch: ok:false with the error's message", async () => {
      const processRunner = makeMockProcessRunner();
      processRunner.execute.mockRejectedValueOnce(new Error("spawn ENOENT"));
      const check = makeSingleRuntimeCheck(processRunner, "cursor");

      await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
      const result = check.getLastResult()!;
      expect(result.results[0]!.binaryCheck.ok).toBe(false);
      expect(result.results[0]!.binaryCheck.error).toBe("spawn ENOENT");
    });

    it("success branch: captures version from the first line of stdout", async () => {
      const processRunner = makeMockProcessRunner();
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return okResult({ stdout: "cursor-agent 2.3.4\nextra line\n" });
        }
        return okResult({ exitCode: 0 });
      });
      const check = makeSingleRuntimeCheck(processRunner, "cursor");

      const result = await check.runPreflight();
      expect(result.results[0]!.binaryCheck.ok).toBe(true);
      expect(result.results[0]!.binaryCheck.version).toBe("cursor-agent 2.3.4");
    });
  });

  describe("checkAuth", () => {
    it("timeout branch: ok:false with timeout error", async () => {
      const processRunner = makeMockProcessRunner();
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return okResult({ stdout: "v1\n" });
        }
        return okResult({ timedOut: true });
      });
      const check = makeSingleRuntimeCheck(processRunner, "cursor");

      await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
      const result = check.getLastResult()!;
      expect(result.results[0]!.authCheck.ok).toBe(false);
      expect(result.results[0]!.authCheck.error).toMatch(/Auth probe timed out after/);
    });

    it("successPattern match branch: ok:true", async () => {
      const processRunner = makeMockProcessRunner();
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return okResult({ stdout: "v1\n" });
        }
        return okResult({ stdout: '{"loggedIn": true}\n' });
      });
      const check = makeSingleRuntimeCheck(processRunner, "claude-code");

      const result = await check.runPreflight();
      expect(result.results[0]!.authCheck.ok).toBe(true);
    });

    it("successPattern no-match branch: ok:false with expected-pattern-not-found error", async () => {
      const processRunner = makeMockProcessRunner();
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return okResult({ stdout: "v1\n" });
        }
        return okResult({ stdout: '{"loggedIn": false}\n' });
      });
      const check = makeSingleRuntimeCheck(processRunner, "claude-code");

      await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
      const result = check.getLastResult()!;
      expect(result.results[0]!.authCheck.ok).toBe(false);
      expect(result.results[0]!.authCheck.error).toMatch(
        /expected pattern not found in output/,
      );
    });

    it("exitCodeOnly pass branch: ok:true on exit code 0", async () => {
      const processRunner = makeMockProcessRunner();
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return okResult({ stdout: "v1\n" });
        }
        return okResult({ exitCode: 0 });
      });
      const check = makeSingleRuntimeCheck(processRunner, "cursor");

      const result = await check.runPreflight();
      expect(result.results[0]!.authCheck.ok).toBe(true);
    });

    it("exitCodeOnly fail branch: ok:false with exit code error", async () => {
      const processRunner = makeMockProcessRunner();
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return okResult({ stdout: "v1\n" });
        }
        return okResult({ exitCode: 1, stderr: "not logged in" });
      });
      const check = makeSingleRuntimeCheck(processRunner, "cursor");

      await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
      const result = check.getLastResult()!;
      expect(result.results[0]!.authCheck.ok).toBe(false);
      expect(result.results[0]!.authCheck.error).toBe("Exit code 1: not logged in");
    });

    it("pong-regex pass branch (default config): ok:true when output contains pong (case-insensitive)", async () => {
      const processRunner = makeMockProcessRunner();
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return okResult({ stdout: "v1\n" });
        }
        return okResult({ stdout: "PONG\n", exitCode: 0 });
      });
      const check = makeSingleRuntimeCheck(processRunner, "codex");

      const result = await check.runPreflight();
      expect(result.results[0]!.authCheck.ok).toBe(true);
    });

    it("pong-regex fail branch with non-zero exit: ok:false with exit code error", async () => {
      const processRunner = makeMockProcessRunner();
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return okResult({ stdout: "v1\n" });
        }
        return okResult({ stdout: "", stderr: "boom", exitCode: 1 });
      });
      const check = makeSingleRuntimeCheck(processRunner, "codex");

      await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
      const result = check.getLastResult()!;
      expect(result.results[0]!.authCheck.ok).toBe(false);
      expect(result.results[0]!.authCheck.error).toBe("Exit code 1: boom");
    });

    it("pong-regex fail branch with exit 0 but no pong in output: ok:false with unexpected-response error", async () => {
      const processRunner = makeMockProcessRunner();
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        if (opts.args.includes("--version")) {
          return okResult({ stdout: "v1\n" });
        }
        return okResult({ stdout: "not the expected text", exitCode: 0 });
      });
      const check = makeSingleRuntimeCheck(processRunner, "codex");

      await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
      const result = check.getLastResult()!;
      expect(result.results[0]!.authCheck.ok).toBe(false);
      expect(result.results[0]!.authCheck.error).toMatch(
        /Auth probe did not return expected response/,
      );
    });

    it("thrown exception branch: ok:false with the error's message", async () => {
      const processRunner = makeMockProcessRunner();
      let callCount = 0;
      processRunner.execute.mockImplementation(async (opts: { args: string[] }) => {
        callCount += 1;
        if (opts.args.includes("--version")) {
          return okResult({ stdout: "v1\n" });
        }
        throw new Error("subprocess crashed");
      });
      const check = makeSingleRuntimeCheck(processRunner, "codex");

      await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
      const result = check.getLastResult()!;
      expect(result.results[0]!.authCheck.ok).toBe(false);
      expect(result.results[0]!.authCheck.error).toBe("subprocess crashed");
      expect(callCount).toBe(2);
    });
  });

  describe("probeRuntime", () => {
    it("skips the auth check (without calling processRunner.execute a second time) when the binary check fails", async () => {
      const processRunner = makeMockProcessRunner();
      processRunner.execute.mockResolvedValueOnce(okResult({ exitCode: 1, stderr: "nope" }));
      const check = makeSingleRuntimeCheck(processRunner, "cursor");

      await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
      const result = check.getLastResult()!;
      expect(result.results[0]!.binaryCheck.ok).toBe(false);
      expect(result.results[0]!.authCheck).toEqual({
        ok: false,
        error: "Skipped: binary check failed",
        durationMs: 0,
      });
      expect(processRunner.execute).toHaveBeenCalledTimes(1);
    });
  });
});
