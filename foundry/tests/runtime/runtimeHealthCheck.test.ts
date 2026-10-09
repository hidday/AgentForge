import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeProcessResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 5,
    timedOut: false,
    ...overrides,
  };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds the expected config shape for each runtime", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--base"],
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
      versionArgs: ["--version"],
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });
    expect(configs.cursor).toMatchObject({
      command: "agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes / getLastResult", () => {
  it("returns the distinct runtimes used by AGENT_STAGES and starts with no last result", () => {
    const logger = makeMockLogger();
    const processRunner = { execute: vi.fn() };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent");
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const required = check.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight", () => {
  let logger: ReturnType<typeof makeMockLogger>;
  let configs: ReturnType<typeof RuntimeHealthCheck.buildRuntimeConfigs>;

  beforeEach(() => {
    logger = makeMockLogger();
    configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
  });

  it("resolves ok:true and skips cursor when every required runtime is healthy", async () => {
    const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.command === "claude") {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeProcessResult({ stdout: "1.2.3\n" }));
        }
        // auth status probe
        return Promise.resolve(
          makeProcessResult({ stdout: '{"loggedIn": true}' }),
        );
      }
      if (opts.command === "codex") {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeProcessResult({ stdout: "0.9.0\n" }));
        }
        return Promise.resolve(makeProcessResult({ stdout: "PONG" }));
      }
      throw new Error(`unexpected command ${opts.command}`);
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    for (const r of result.results) {
      expect(r.binaryCheck.ok).toBe(true);
      expect(r.authCheck.ok).toBe(true);
    }
    expect(check.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("skips the auth check and rejects with PreflightError when the binary check fails", async () => {
    const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        return Promise.resolve(makeProcessResult({ exitCode: 1, stderr: "not found" }));
      }
      if (opts.command === "codex") {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeProcessResult({ stdout: "0.9.0\n" }));
        }
        return Promise.resolve(makeProcessResult({ stdout: "PONG" }));
      }
      throw new Error(`unexpected call for ${opts.command}`);
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const lastResult = check.getLastResult();
    expect(lastResult?.ok).toBe(false);
    const claudeResult = lastResult?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toContain("Exit code 1");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("Skipped: binary check failed");

    // auth probe must never have been attempted for claude since binary check failed
    expect(
      execute.mock.calls.some(
        (call) => call[0].command === "claude" && call[0].args[0] === "auth",
      ),
    ).toBe(false);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([expect.objectContaining({ runtime: "claude-code" })]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("marks binaryCheck not ok when the version probe times out", async () => {
    const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        return Promise.resolve(makeProcessResult({ timedOut: true }));
      }
      if (opts.command === "codex") {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeProcessResult({ stdout: "0.9.0\n" }));
        }
        return Promise.resolve(makeProcessResult({ stdout: "PONG" }));
      }
      throw new Error("unexpected");
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult();
    const claudeResult = result?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.error).toContain("Timed out after");
  });

  it("catches an exception thrown by the version probe and reports it as a binary check failure", async () => {
    const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.command === "claude" && opts.args[0] === "--version") {
        return Promise.reject(new Error("ENOENT: no such binary"));
      }
      if (opts.command === "codex") {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeProcessResult({ stdout: "0.9.0\n" }));
        }
        return Promise.resolve(makeProcessResult({ stdout: "PONG" }));
      }
      throw new Error("unexpected");
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult();
    const claudeResult = result?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toBe("ENOENT: no such binary");
  });

  it("fails the auth check when the probe times out", async () => {
    const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.command === "claude") {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeProcessResult({ stdout: "1.0.0" }));
        }
        return Promise.resolve(makeProcessResult({ timedOut: true }));
      }
      if (opts.command === "codex") {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeProcessResult({ stdout: "0.9.0" }));
        }
        return Promise.resolve(makeProcessResult({ stdout: "PONG" }));
      }
      throw new Error("unexpected");
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult();
    const claudeResult = result?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.error).toContain("Auth probe timed out after");
  });

  it("fails the auth check when the success pattern does not match", async () => {
    const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.command === "claude") {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeProcessResult({ stdout: "1.0.0" }));
        }
        return Promise.resolve(makeProcessResult({ stdout: '{"loggedIn": false}' }));
      }
      if (opts.command === "codex") {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeProcessResult({ stdout: "0.9.0" }));
        }
        return Promise.resolve(makeProcessResult({ stdout: "PONG" }));
      }
      throw new Error("unexpected");
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult();
    const claudeResult = result?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("expected pattern not found");
  });

  it("fails the auth check when exit code is non-zero and no pong is present", async () => {
    const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.command === "claude") {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeProcessResult({ stdout: "1.0.0" }));
        }
        return Promise.resolve(makeProcessResult({ stdout: '{"loggedIn": true}' }));
      }
      if (opts.command === "codex") {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeProcessResult({ stdout: "0.9.0" }));
        }
        return Promise.resolve(
          makeProcessResult({ exitCode: 1, stderr: "connection refused" }),
        );
      }
      throw new Error("unexpected");
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult();
    const codexResult = result?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("Exit code 1");
  });

  it("fails the auth check when exit code is 0 but no pong is present", async () => {
    const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.command === "claude") {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeProcessResult({ stdout: "1.0.0" }));
        }
        return Promise.resolve(makeProcessResult({ stdout: '{"loggedIn": true}' }));
      }
      if (opts.command === "codex") {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeProcessResult({ stdout: "0.9.0" }));
        }
        return Promise.resolve(makeProcessResult({ stdout: "nothing useful" }));
      }
      throw new Error("unexpected");
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult();
    const codexResult = result?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("did not return expected response");
  });

  it("passes the auth check on exit code 0 even without pong when a non-zero/pong condition isn't hit (regression: hasPong true path short-circuits exit-code check)", async () => {
    // exitCode !== 0 but hasPong true should still pass (branch: `exitCode !== 0 && !hasPong`).
    const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.command === "claude") {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeProcessResult({ stdout: "1.0.0" }));
        }
        return Promise.resolve(makeProcessResult({ stdout: '{"loggedIn": true}' }));
      }
      if (opts.command === "codex") {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeProcessResult({ stdout: "0.9.0" }));
        }
        return Promise.resolve(makeProcessResult({ exitCode: 7, stdout: "PONG anyway" }));
      }
      throw new Error("unexpected");
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });

  it("catches an exception thrown by the auth probe and reports it as an auth check failure", async () => {
    const execute = vi.fn().mockImplementation((opts: { command: string; args: string[] }) => {
      if (opts.command === "claude") {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeProcessResult({ stdout: "1.0.0" }));
        }
        return Promise.reject(new Error("socket hang up"));
      }
      if (opts.command === "codex") {
        if (opts.args[0] === "--version") {
          return Promise.resolve(makeProcessResult({ stdout: "0.9.0" }));
        }
        return Promise.resolve(makeProcessResult({ stdout: "PONG" }));
      }
      throw new Error("unexpected");
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult();
    const claudeResult = result?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toBe("socket hang up");
  });
});

describe("RuntimeHealthCheck exitCodeOnly branch (cursor, probed directly)", () => {
  it("passes when exit code is 0", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent");
    const execute = vi.fn().mockResolvedValue(makeProcessResult({ exitCode: 0 }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    type Internal = {
      checkAuth: (config: (typeof configs)["cursor"]) => Promise<{ ok: boolean; error?: string }>;
    };
    const auth = await (check as unknown as Internal).checkAuth(configs.cursor);
    expect(auth.ok).toBe(true);
  });

  it("fails when exit code is non-zero", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent");
    const execute = vi
      .fn()
      .mockResolvedValue(makeProcessResult({ exitCode: 3, stderr: "not logged in" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    type Internal = {
      checkAuth: (config: (typeof configs)["cursor"]) => Promise<{ ok: boolean; error?: string }>;
    };
    const auth = await (check as unknown as Internal).checkAuth(configs.cursor);
    expect(auth.ok).toBe(false);
    expect(auth.error).toContain("Exit code 3");
    expect(auth.error).toContain("not logged in");
  });

  it("falls back to stdout in the error message when stderr is empty (the `stderr || stdout` branch)", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent");
    const execute = vi
      .fn()
      .mockResolvedValue(makeProcessResult({ exitCode: 5, stderr: "", stdout: "from stdout" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    type Internal = {
      checkAuth: (config: (typeof configs)["cursor"]) => Promise<{ ok: boolean; error?: string }>;
    };
    const auth = await (check as unknown as Internal).checkAuth(configs.cursor);
    expect(auth.ok).toBe(false);
    expect(auth.error).toContain("from stdout");
  });
});

describe("RuntimeHealthCheck exception branches (non-Error throwables)", () => {
  it("checkBinary stringifies a non-Error value thrown by the version probe", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent");
    // eslint-disable-next-line prefer-promise-reject-errors
    const execute = vi.fn().mockRejectedValue("a plain string rejection");
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    type Internal = {
      checkBinary: (
        config: (typeof configs)["claude-code"],
      ) => Promise<{ ok: boolean; error?: string }>;
    };
    const binary = await (check as unknown as Internal).checkBinary(configs["claude-code"]);
    expect(binary.ok).toBe(false);
    expect(binary.error).toBe("a plain string rejection");
  });

  it("checkAuth stringifies a non-Error value thrown by the auth probe", async () => {
    const logger = makeMockLogger();
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "agent");
    // eslint-disable-next-line prefer-promise-reject-errors
    const execute = vi.fn().mockRejectedValue({ reason: "weird rejection" });
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    type Internal = {
      checkAuth: (config: (typeof configs)["cursor"]) => Promise<{ ok: boolean; error?: string }>;
    };
    const auth = await (check as unknown as Internal).checkAuth(configs.cursor);
    expect(auth.ok).toBe(false);
    expect(auth.error).toBe(String({ reason: "weird rejection" }));
  });
});
