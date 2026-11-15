import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { AgentRuntime } from "../../src/domain/types.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function okResult(stdout = ""): ProcessResult {
  return { stdout, stderr: "", exitCode: 0, durationMs: 1, timedOut: false };
}

function failResult(exitCode: number, stderr = "boom"): ProcessResult {
  return { stdout: "", stderr, exitCode, durationMs: 1, timedOut: false };
}

function timedOutResult(): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 1, durationMs: 1, timedOut: true };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeConfigs(overrides: Partial<Record<AgentRuntime, ReturnType<typeof baseConfig>>> = {}) {
  return {
    "claude-code": overrides["claude-code"] ?? baseConfig("claude-bin", { successPattern: "OK" }),
    codex: overrides.codex ?? baseConfig("codex-bin", {}),
    cursor: overrides.cursor ?? baseConfig("cursor-bin", { exitCodeOnly: true }),
  };
}

function baseConfig(
  command: string,
  extra: { successPattern?: string; exitCodeOnly?: boolean; probeStdin?: string },
) {
  return {
    command,
    versionArgs: ["--version"],
    probeArgs: ["probe"],
    ...extra,
  };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs()", () => {
  it("wires each runtime's command and probe args, with claude-code using an auth-status probe", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--base"],
      "codex",
      ["exec"],
      "cursor",
    );

    expect(configs["claude-code"].command).toBe("claude");
    expect(configs["claude-code"].probeArgs).toEqual(["auth", "status"]);
    expect(configs["claude-code"].successPattern).toContain("loggedIn");

    expect(configs.codex.command).toBe("codex");
    expect(configs.codex.probeArgs).toEqual(["exec"]);
    expect(configs.codex.probeStdin).toBe("Respond with exactly: PONG");

    expect(configs.cursor.command).toBe("cursor");
    expect(configs.cursor.exitCodeOnly).toBe(true);
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes()", () => {
  it("derives the required runtime set from AGENT_STAGES, excluding unused runtimes", () => {
    const health = new RuntimeHealthCheck({ execute: vi.fn() } as never, makeConfigs(), makeLogger());
    const required = health.getRequiredRuntimes();
    expect(required).toEqual(new Set(["claude-code", "codex"]));
    expect(required.has("cursor")).toBe(false);
  });
});

describe("RuntimeHealthCheck.getLastResult()", () => {
  it("returns undefined before any preflight has run", () => {
    const health = new RuntimeHealthCheck({ execute: vi.fn() } as never, makeConfigs(), makeLogger());
    expect(health.getLastResult()).toBeUndefined();
  });

  it("caches the most recent preflight result after a successful run", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult("v1");
      return okResult(opts.command === "codex-bin" ? "PONG" : "OK");
    });
    const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger());

    const result = await health.runPreflight();

    expect(health.getLastResult()).toBe(result);
  });
});

describe("RuntimeHealthCheck.runPreflight()", () => {
  it("passes, lists skipped runtimes, and logs success when every required runtime is healthy", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult("v1.0.0");
      return okResult(opts.command === "codex-bin" ? "PONG" : "OK");
    });
    const logger = makeLogger();
    const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), logger);

    const result = await health.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    for (const r of result.results) {
      expect(r.binaryCheck.ok).toBe(true);
      expect(r.binaryCheck.version).toBe("v1.0.0");
      expect(r.authCheck.ok).toBe(true);
    }
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("skips the auth check and fails when the binary version check times out", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args[0] === "--version") return timedOutResult();
      return okResult("OK");
    });
    const logger = makeLogger();
    const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), logger);

    await expect(health.runPreflight()).rejects.toThrow(PreflightError);

    const result = health.getLastResult();
    expect(result?.ok).toBe(false);
    for (const r of result?.results ?? []) {
      expect(r.binaryCheck.ok).toBe(false);
      expect(r.binaryCheck.error).toContain("Timed out after");
      expect(r.authCheck.ok).toBe(false);
      expect(r.authCheck.error).toBe("Skipped: binary check failed");
    }
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ runtime: "claude-code", binaryError: expect.any(String) }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("fails with a formatted error when the binary check exits non-zero", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args[0] === "--version") return failResult(127, "command not found");
      return okResult("OK");
    });
    const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger());

    const error = (await health.runPreflight().catch((e) => e)) as PreflightError;
    expect(error).toBeInstanceOf(PreflightError);
    const failing = error.result.results.find((r) => !r.binaryCheck.ok);
    expect(failing?.binaryCheck.error).toContain("Exit code 127");
    expect(failing?.binaryCheck.error).toContain("command not found");
  });

  it("surfaces a thrown error from the binary check as a non-ok result instead of rejecting runPreflight itself", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.command === "claude-bin" && opts.args[0] === "--version") {
        throw new Error("spawn failed");
      }
      if (opts.args[0] === "--version") return okResult("v1");
      return okResult("OK");
    });
    const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger());

    const error = (await health.runPreflight().catch((e) => e)) as PreflightError;
    expect(error).toBeInstanceOf(PreflightError);
    const claude = error.result.results.find((r) => r.runtime === "claude-code");
    expect(claude?.binaryCheck.ok).toBe(false);
    expect(claude?.binaryCheck.error).toBe("spawn failed");
  });

  it("fails auth when the configured success pattern is not found in the probe output", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args[0] === "--version") return okResult("v1");
      if (opts.command === "claude-bin") return okResult("not the right output");
      return okResult("OK");
    });
    const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger());

    const error = (await health.runPreflight().catch((e) => e)) as PreflightError;
    const claude = error.result.results.find((r) => r.runtime === "claude-code");
    expect(claude?.authCheck.ok).toBe(false);
    expect(claude?.authCheck.error).toContain("expected pattern not found");
  });

  it("passes auth via exitCodeOnly when the probe exits zero, regardless of output", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args[0] === "--version") return okResult("v1");
      if (opts.command === "codex-bin") return okResult("irrelevant text");
      return okResult("OK");
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      makeConfigs({ codex: baseConfig("codex-bin", { exitCodeOnly: true }) }),
      makeLogger(),
    );

    const result = await health.runPreflight();
    const codex = result.results.find((r) => r.runtime === "codex");
    expect(codex?.authCheck.ok).toBe(true);
  });

  it("fails auth via exitCodeOnly when the probe exits non-zero", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args[0] === "--version") return okResult("v1");
      if (opts.command === "codex-bin") return failResult(2, "auth error");
      return okResult("OK");
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      makeConfigs({ codex: baseConfig("codex-bin", { exitCodeOnly: true }) }),
      makeLogger(),
    );

    const error = (await health.runPreflight().catch((e) => e)) as PreflightError;
    const codex = error.result.results.find((r) => r.runtime === "codex");
    expect(codex?.authCheck.ok).toBe(false);
    expect(codex?.authCheck.error).toContain("Exit code 2");
  });

  it("passes the default (pong) auth probe when the output contains 'pong' even on a non-zero exit code", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args[0] === "--version") return okResult("v1");
      if (opts.command === "codex-bin") return failResult(1, "PONG received anyway");
      return okResult("OK");
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      makeConfigs({ codex: baseConfig("codex-bin", {}) }),
      makeLogger(),
    );

    const result = await health.runPreflight();
    const codex = result.results.find((r) => r.runtime === "codex");
    expect(codex?.authCheck.ok).toBe(true);
  });

  it("fails the default (pong) auth probe on a non-zero exit with no pong in the output", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args[0] === "--version") return okResult("v1");
      if (opts.command === "codex-bin") return failResult(1, "nope");
      return okResult("OK");
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      makeConfigs({ codex: baseConfig("codex-bin", {}) }),
      makeLogger(),
    );

    const error = (await health.runPreflight().catch((e) => e)) as PreflightError;
    const codex = error.result.results.find((r) => r.runtime === "codex");
    expect(codex?.authCheck.ok).toBe(false);
    expect(codex?.authCheck.error).toContain("Exit code 1");
  });

  it("fails the default (pong) auth probe on exit code zero but no pong in the output", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args[0] === "--version") return okResult("v1");
      if (opts.command === "codex-bin") return okResult("no magic word here");
      return okResult("OK");
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      makeConfigs({ codex: baseConfig("codex-bin", {}) }),
      makeLogger(),
    );

    const error = (await health.runPreflight().catch((e) => e)) as PreflightError;
    const codex = error.result.results.find((r) => r.runtime === "codex");
    expect(codex?.authCheck.ok).toBe(false);
    expect(codex?.authCheck.error).toContain("did not return expected response");
  });

  it("marks auth as failed when the auth probe itself times out", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args[0] === "--version") return okResult("v1");
      if (opts.command === "codex-bin") return timedOutResult();
      return okResult("OK");
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      makeConfigs({ codex: baseConfig("codex-bin", {}) }),
      makeLogger(),
    );

    const error = (await health.runPreflight().catch((e) => e)) as PreflightError;
    const codex = error.result.results.find((r) => r.runtime === "codex");
    expect(codex?.authCheck.ok).toBe(false);
    expect(codex?.authCheck.error).toContain("Auth probe timed out");
  });

  it("marks auth as failed when the auth probe throws", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args[0] === "--version") return okResult("v1");
      if (opts.command === "codex-bin") throw new Error("probe crashed");
      return okResult("OK");
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      makeConfigs({ codex: baseConfig("codex-bin", {}) }),
      makeLogger(),
    );

    const error = (await health.runPreflight().catch((e) => e)) as PreflightError;
    const codex = error.result.results.find((r) => r.runtime === "codex");
    expect(codex?.authCheck.ok).toBe(false);
    expect(codex?.authCheck.error).toBe("probe crashed");
  });

  it("stringifies a non-Error thrown by the binary check", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.command === "claude-bin" && opts.args[0] === "--version") {
        throw "raw string failure";
      }
      if (opts.args[0] === "--version") return okResult("v1");
      return okResult("OK");
    });
    const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger());

    const error = (await health.runPreflight().catch((e) => e)) as PreflightError;
    const claude = error.result.results.find((r) => r.runtime === "claude-code");
    expect(claude?.binaryCheck.error).toBe("raw string failure");
  });

  it("stringifies a non-Error thrown by the auth probe", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args[0] === "--version") return okResult("v1");
      if (opts.command === "codex-bin") throw "raw auth failure";
      return okResult("OK");
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      makeConfigs({ codex: baseConfig("codex-bin", {}) }),
      makeLogger(),
    );

    const error = (await health.runPreflight().catch((e) => e)) as PreflightError;
    const codex = error.result.results.find((r) => r.runtime === "codex");
    expect(codex?.authCheck.error).toBe("raw auth failure");
  });

  it("falls back to stdout in the exitCodeOnly error message when stderr is empty", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args[0] === "--version") return okResult("v1");
      if (opts.command === "codex-bin") {
        return { stdout: "only stdout here", stderr: "", exitCode: 3, durationMs: 1, timedOut: false };
      }
      return okResult("OK");
    });
    const health = new RuntimeHealthCheck(
      { execute } as never,
      makeConfigs({ codex: baseConfig("codex-bin", { exitCodeOnly: true }) }),
      makeLogger(),
    );

    const error = (await health.runPreflight().catch((e) => e)) as PreflightError;
    const codex = error.result.results.find((r) => r.runtime === "codex");
    expect(codex?.authCheck.error).toBe("Exit code 3: only stdout here");
  });
});

describe("PreflightError", () => {
  it("names only the failing runtimes in its message", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[]; command: string }) => {
      if (opts.args[0] === "--version") return okResult("v1");
      if (opts.command === "claude-bin") return okResult("OK");
      return failResult(1, "down");
    });
    const health = new RuntimeHealthCheck({ execute } as never, makeConfigs(), makeLogger());

    const error = (await health.runPreflight().catch((e) => e)) as PreflightError;
    expect(error.message).toBe("Preflight failed for runtimes: codex");
    expect(error.name).toBe("PreflightError");
  });
});
