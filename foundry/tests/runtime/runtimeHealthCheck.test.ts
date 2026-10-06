import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import type { ProcessResult, ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";
import { PreflightError } from "../../src/utils/errors.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function okResult(stdout: string, overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout, stderr: "", exitCode: 0, durationMs: 10, timedOut: false, ...overrides };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs()", () => {
  it("builds command/version/probe config for all three runtimes", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--print"],
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

describe("RuntimeHealthCheck.getRequiredRuntimes()", () => {
  it("returns the distinct runtimes referenced by AGENT_STAGES (claude-code and codex, never cursor)", () => {
    const health = new RuntimeHealthCheck({ execute: vi.fn() } as never, {} as never, makeMockLogger() as never);
    const required = health.getRequiredRuntimes();
    expect(required).toEqual(new Set(["claude-code", "codex"]));
    expect(required.has("cursor")).toBe(false);
  });
});

describe("RuntimeHealthCheck.getLastResult()", () => {
  it("returns undefined before any preflight has run", () => {
    const health = new RuntimeHealthCheck({ execute: vi.fn() } as never, {} as never, makeMockLogger() as never);
    expect(health.getLastResult()).toBeUndefined();
  });
});

const configs = RuntimeHealthCheck.buildRuntimeConfigs(
  "claude",
  ["--print"],
  "codex",
  ["exec", "-"],
  "agent",
);

describe("RuntimeHealthCheck.runPreflight()", () => {
  let logger: ReturnType<typeof makeMockLogger>;

  beforeEach(() => {
    logger = makeMockLogger();
  });

  it("resolves ok:true when every required runtime's binary and auth checks pass", async () => {
    const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
      if (opts.command === "claude") {
        if (opts.args.includes("--version")) return okResult("1.2.3");
        return okResult('{"loggedIn": true}');
      }
      if (opts.command === "codex") {
        if (opts.args.includes("--version")) return okResult("0.9.0");
        return okResult("PONG received");
      }
      throw new Error(`unexpected command ${opts.command}`);
    });

    const health = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    const result = await health.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.binaryCheck.ok && r.authCheck.ok)).toBe(true);
    expect(health.getLastResult()).toBe(result);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("throws PreflightError and records the failure when a binary check fails, skipping its auth check", async () => {
    const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
      if (opts.command === "claude") {
        if (opts.args.includes("--version")) {
          return okResult("", { exitCode: 127, stderr: "command not found: claude" });
        }
        throw new Error("auth check should not run when binary check fails");
      }
      if (opts.command === "codex") {
        if (opts.args.includes("--version")) return okResult("0.9.0");
        return okResult("PONG received");
      }
      throw new Error(`unexpected command ${opts.command}`);
    });

    const health = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);

    const lastResult = health.getLastResult();
    expect(lastResult?.ok).toBe(false);
    const claudeResult = lastResult?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toContain("Exit code 127");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toBe("Skipped: binary check failed");
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("marks binaryCheck failed when the process times out", async () => {
    const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
      if (opts.command === "claude" && opts.args.includes("--version")) {
        return okResult("", { timedOut: true, exitCode: 1 });
      }
      if (opts.command === "claude") return okResult('{"loggedIn": true}');
      if (opts.command === "codex") {
        if (opts.args.includes("--version")) return okResult("0.9.0");
        return okResult("PONG received");
      }
      throw new Error(`unexpected command ${opts.command}`);
    });

    const health = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    await expect(health.runPreflight()).rejects.toThrow(PreflightError);

    const claudeResult = health.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toContain("Timed out after");
  });

  it("marks binaryCheck failed when processRunner.execute throws", async () => {
    const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
      if (opts.command === "claude" && opts.args.includes("--version")) {
        throw new Error("ENOENT: spawn claude");
      }
      if (opts.command === "codex") {
        if (opts.args.includes("--version")) return okResult("0.9.0");
        return okResult("PONG received");
      }
      throw new Error(`unexpected command ${opts.command}`);
    });

    const health = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    await expect(health.runPreflight()).rejects.toThrow(PreflightError);

    const claudeResult = health.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toBe("ENOENT: spawn claude");
  });

  it("stringifies a non-Error value thrown by processRunner.execute during the binary check", async () => {
    const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
      if (opts.command === "claude" && opts.args.includes("--version")) {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "plain-string-binary-failure";
      }
      if (opts.command === "codex") {
        if (opts.args.includes("--version")) return okResult("0.9.0");
        return okResult("PONG received");
      }
      throw new Error(`unexpected command ${opts.command}`);
    });

    const health = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    await expect(health.runPreflight()).rejects.toThrow(PreflightError);

    const claudeResult = health.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toBe("plain-string-binary-failure");
  });

  it("truncates a multi-line version string to its first line, capped at 100 chars", async () => {
    const longLine = "v".repeat(150);
    const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
      if (opts.command === "claude") {
        if (opts.args.includes("--version")) return okResult(`${longLine}\nextra line`);
        return okResult('{"loggedIn": true}');
      }
      if (opts.command === "codex") {
        if (opts.args.includes("--version")) return okResult("0.9.0");
        return okResult("PONG received");
      }
      throw new Error(`unexpected command ${opts.command}`);
    });

    const health = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    const result = await health.runPreflight();
    const claudeResult = result.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.version).toBe(longLine.slice(0, 100));
    expect(claudeResult?.binaryCheck.version?.length).toBe(100);
  });

  it("fails authCheck when the successPattern regex does not match stdout/stderr", async () => {
    const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
      if (opts.command === "claude") {
        if (opts.args.includes("--version")) return okResult("1.0.0");
        return okResult('{"loggedIn": false}');
      }
      if (opts.command === "codex") {
        if (opts.args.includes("--version")) return okResult("0.9.0");
        return okResult("PONG received");
      }
      throw new Error(`unexpected command ${opts.command}`);
    });

    const health = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    await expect(health.runPreflight()).rejects.toThrow(PreflightError);

    const claudeResult = health.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("expected pattern not found");
  });

  it("fails authCheck on timeout during the auth probe", async () => {
    const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
      if (opts.command === "claude") {
        if (opts.args.includes("--version")) return okResult("1.0.0");
        return okResult("", { timedOut: true });
      }
      if (opts.command === "codex") {
        if (opts.args.includes("--version")) return okResult("0.9.0");
        return okResult("PONG received");
      }
      throw new Error(`unexpected command ${opts.command}`);
    });

    const health = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    await expect(health.runPreflight()).rejects.toThrow(PreflightError);

    const claudeResult = health.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("Auth probe timed out after");
  });

  it("fails authCheck when processRunner.execute throws during the auth probe", async () => {
    const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
      if (opts.command === "claude") {
        if (opts.args.includes("--version")) return okResult("1.0.0");
        throw new Error("socket hang up");
      }
      if (opts.command === "codex") {
        if (opts.args.includes("--version")) return okResult("0.9.0");
        return okResult("PONG received");
      }
      throw new Error(`unexpected command ${opts.command}`);
    });

    const health = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    await expect(health.runPreflight()).rejects.toThrow(PreflightError);

    const claudeResult = health.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toBe("socket hang up");
  });

  it("stringifies a non-Error value thrown by processRunner.execute during the auth probe", async () => {
    const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
      if (opts.command === "claude") {
        if (opts.args.includes("--version")) return okResult("1.0.0");
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "plain-string-auth-failure";
      }
      if (opts.command === "codex") {
        if (opts.args.includes("--version")) return okResult("0.9.0");
        return okResult("PONG received");
      }
      throw new Error(`unexpected command ${opts.command}`);
    });

    const health = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    await expect(health.runPreflight()).rejects.toThrow(PreflightError);

    const claudeResult = health.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toBe("plain-string-auth-failure");
  });

  describe("exitCodeOnly auth check (cursor-style config probed directly)", () => {
    const exitCodeOnlyConfigs = {
      "claude-code": configs["claude-code"],
      codex: {
        command: "codex",
        versionArgs: ["--version"],
        probeArgs: ["status"],
        exitCodeOnly: true as const,
      },
      cursor: configs.cursor,
    };

    it("passes when exitCodeOnly and the probe exits 0", async () => {
      const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
        if (opts.command === "claude") {
          if (opts.args.includes("--version")) return okResult("1.0.0");
          return okResult('{"loggedIn": true}');
        }
        if (opts.command === "codex") {
          if (opts.args.includes("--version")) return okResult("0.9.0");
          return okResult("", { exitCode: 0 });
        }
        throw new Error(`unexpected command ${opts.command}`);
      });

      const health = new RuntimeHealthCheck(
        { execute } as never,
        exitCodeOnlyConfigs as never,
        logger as never,
      );
      const result = await health.runPreflight();
      expect(result.ok).toBe(true);
    });

    it("fails when exitCodeOnly and the probe exits non-zero, surfacing stderr", async () => {
      const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
        if (opts.command === "claude") {
          if (opts.args.includes("--version")) return okResult("1.0.0");
          return okResult('{"loggedIn": true}');
        }
        if (opts.command === "codex") {
          if (opts.args.includes("--version")) return okResult("0.9.0");
          return okResult("", { exitCode: 3, stderr: "not logged in" });
        }
        throw new Error(`unexpected command ${opts.command}`);
      });

      const health = new RuntimeHealthCheck(
        { execute } as never,
        exitCodeOnlyConfigs as never,
        logger as never,
      );
      await expect(health.runPreflight()).rejects.toThrow(PreflightError);
      const codexResult = health.getLastResult()?.results.find((r) => r.runtime === "codex");
      expect(codexResult?.authCheck.ok).toBe(false);
      expect(codexResult?.authCheck.error).toContain("Exit code 3");
      expect(codexResult?.authCheck.error).toContain("not logged in");
    });

    it("falls back to stdout in the error message when exitCodeOnly fails with empty stderr", async () => {
      const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
        if (opts.command === "claude") {
          if (opts.args.includes("--version")) return okResult("1.0.0");
          return okResult('{"loggedIn": true}');
        }
        if (opts.command === "codex") {
          if (opts.args.includes("--version")) return okResult("0.9.0");
          // stderr is empty; the error message must fall back to stdout.
          return okResult("denied: no active session", { exitCode: 3, stderr: "" });
        }
        throw new Error(`unexpected command ${opts.command}`);
      });

      const health = new RuntimeHealthCheck(
        { execute } as never,
        exitCodeOnlyConfigs as never,
        logger as never,
      );
      await expect(health.runPreflight()).rejects.toThrow(PreflightError);
      const codexResult = health.getLastResult()?.results.find((r) => r.runtime === "codex");
      expect(codexResult?.authCheck.ok).toBe(false);
      expect(codexResult?.authCheck.error).toContain("Exit code 3");
      expect(codexResult?.authCheck.error).toContain("denied: no active session");
    });
  });

  describe("default (PONG-style) auth check", () => {
    it("passes when exit code is 0 and output contains PONG case-insensitively", async () => {
      const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
        if (opts.command === "claude") {
          if (opts.args.includes("--version")) return okResult("1.0.0");
          return okResult('{"loggedIn": true}');
        }
        if (opts.command === "codex") {
          if (opts.args.includes("--version")) return okResult("0.9.0");
          return okResult("pong\n");
        }
        throw new Error(`unexpected command ${opts.command}`);
      });

      const health = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
      const result = await health.runPreflight();
      expect(result.ok).toBe(true);
    });

    it("passes when exit code is non-zero but PONG is still present in the output", async () => {
      const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
        if (opts.command === "claude") {
          if (opts.args.includes("--version")) return okResult("1.0.0");
          return okResult('{"loggedIn": true}');
        }
        if (opts.command === "codex") {
          if (opts.args.includes("--version")) return okResult("0.9.0");
          return okResult("PONG", { exitCode: 1 });
        }
        throw new Error(`unexpected command ${opts.command}`);
      });

      const health = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
      const result = await health.runPreflight();
      expect(result.ok).toBe(true);
    });

    it("fails when exit code is non-zero and no PONG is present", async () => {
      const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
        if (opts.command === "claude") {
          if (opts.args.includes("--version")) return okResult("1.0.0");
          return okResult('{"loggedIn": true}');
        }
        if (opts.command === "codex") {
          if (opts.args.includes("--version")) return okResult("0.9.0");
          return okResult("", { exitCode: 1, stderr: "rate limited" });
        }
        throw new Error(`unexpected command ${opts.command}`);
      });

      const health = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
      await expect(health.runPreflight()).rejects.toThrow(PreflightError);
      const codexResult = health.getLastResult()?.results.find((r) => r.runtime === "codex");
      expect(codexResult?.authCheck.ok).toBe(false);
      expect(codexResult?.authCheck.error).toContain("Exit code 1");
      expect(codexResult?.authCheck.error).toContain("rate limited");
    });

    it("fails when exit code is 0 but no PONG is present in the output", async () => {
      const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
        if (opts.command === "claude") {
          if (opts.args.includes("--version")) return okResult("1.0.0");
          return okResult('{"loggedIn": true}');
        }
        if (opts.command === "codex") {
          if (opts.args.includes("--version")) return okResult("0.9.0");
          return okResult("unexpected garbage", { exitCode: 0 });
        }
        throw new Error(`unexpected command ${opts.command}`);
      });

      const health = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
      await expect(health.runPreflight()).rejects.toThrow(PreflightError);
      const codexResult = health.getLastResult()?.results.find((r) => r.runtime === "codex");
      expect(codexResult?.authCheck.ok).toBe(false);
      expect(codexResult?.authCheck.error).toContain("did not return expected response");
    });
  });

  it("probes all required runtimes concurrently (both commands are invoked)", async () => {
    const calledCommands = new Set<string>();
    const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
      calledCommands.add(opts.command);
      if (opts.command === "claude") {
        if (opts.args.includes("--version")) return okResult("1.0.0");
        return okResult('{"loggedIn": true}');
      }
      return opts.args.includes("--version") ? okResult("0.9.0") : okResult("PONG");
    });

    const health = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    await health.runPreflight();

    expect(calledCommands).toEqual(new Set(["claude", "codex"]));
    expect(execute).toHaveBeenCalledTimes(4); // 2 runtimes x (binary + auth)
  });

  it("passes stdinData through to the auth probe when the config defines probeStdin", async () => {
    const execute = vi.fn(async (opts: ProcessSpawnOptions) => {
      if (opts.command === "claude") {
        if (opts.args.includes("--version")) return okResult("1.0.0");
        return okResult('{"loggedIn": true}');
      }
      if (opts.command === "codex") {
        if (opts.args.includes("--version")) return okResult("0.9.0");
        return okResult("PONG");
      }
      throw new Error(`unexpected command ${opts.command}`);
    });

    const health = new RuntimeHealthCheck({ execute } as never, configs, logger as never);
    await health.runPreflight();

    const codexAuthCall = execute.mock.calls.find(
      (call) => (call[0] as ProcessSpawnOptions).command === "codex" && !(call[0] as ProcessSpawnOptions).args.includes("--version"),
    );
    expect(codexAuthCall?.[0]).toMatchObject({ stdinData: "Respond with exactly: PONG" });
  });
});
