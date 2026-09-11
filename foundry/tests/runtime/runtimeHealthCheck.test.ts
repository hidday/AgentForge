import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function okResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 5,
    timedOut: false,
    ...overrides,
  };
}

const configs = RuntimeHealthCheck.buildRuntimeConfigs(
  "claude",
  ["--print"],
  "codex",
  ["exec", "-"],
  "cursor-agent",
);

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds a claude-code config with an auth-status probe and success pattern", () => {
    expect(configs["claude-code"]).toMatchObject({
      command: "claude",
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });
  });

  it("builds a codex config using the caller-supplied base args and a PONG stdin probe", () => {
    expect(configs.codex).toMatchObject({
      command: "codex",
      versionArgs: ["--version"],
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });
  });

  it("builds a cursor config that only checks exit code for auth", () => {
    expect(configs.cursor).toMatchObject({
      command: "cursor-agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes", () => {
  it("derives the required runtime set from AGENT_STAGES (claude-code and codex, no cursor stage exists)", () => {
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck({ execute: vi.fn() } as never, configs, logger as never);
    const required = check.getRequiredRuntimes();
    expect(required).toEqual(new Set(["claude-code", "codex"]));
  });
});

describe("RuntimeHealthCheck.getLastResult", () => {
  it("returns undefined before any preflight has run", () => {
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck({ execute: vi.fn() } as never, configs, logger as never);
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight — success path", () => {
  it("resolves ok:true, lists cursor as skipped, and caches the result for getLastResult", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.2.3\n" });
      if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      // codex probe
      return okResult({ stdout: "PONG" });
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck(
      { execute } as never,
      configs,
      logger as never,
    );

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(typeof result.totalDurationMs).toBe("number");
    expect(check.getLastResult()).toBe(result);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });
});

describe("RuntimeHealthCheck.runPreflight — failure paths", () => {
  it("throws PreflightError and skips the auth check when the binary check fails (non-zero exit)", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version" && opts.command === "claude") {
        return okResult({ exitCode: 127, stderr: "command not found", stdout: "" });
      }
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      return okResult({ stdout: "PONG" });
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const lastResult = check.getLastResult();
    expect(lastResult?.ok).toBe(false);
    const claudeEntry = lastResult?.results.find((r) => r.runtime === "claude-code");
    expect(claudeEntry?.binaryCheck.ok).toBe(false);
    expect(claudeEntry?.binaryCheck.error).toContain("Exit code 127");
    expect(claudeEntry?.authCheck.ok).toBe(false);
    expect(claudeEntry?.authCheck.error).toBe("Skipped: binary check failed");
    expect(claudeEntry?.authCheck.durationMs).toBe(0);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ runtime: "claude-code", binaryError: expect.any(String) }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("marks the binary check failed when the version probe times out", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version" && opts.command === "claude") {
        return okResult({ timedOut: true });
      }
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      return okResult({ stdout: "PONG" });
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeEntry = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeEntry?.binaryCheck.ok).toBe(false);
    expect(claudeEntry?.binaryCheck.error).toContain("Timed out after");
  });

  it("captures a thrown error from the binary check as a failure rather than rejecting the whole preflight loop", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version" && opts.command === "claude") {
        throw new Error("spawn ENOENT");
      }
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      return okResult({ stdout: "PONG" });
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeEntry = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeEntry?.binaryCheck.ok).toBe(false);
    expect(claudeEntry?.binaryCheck.error).toBe("spawn ENOENT");
  });

  it("fails the auth check when the successPattern (claude-code) does not match stdout/stderr", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": false}' });
      return okResult({ stdout: "PONG" });
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeEntry = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeEntry?.authCheck.ok).toBe(false);
    expect(claudeEntry?.authCheck.error).toContain("expected pattern not found");
  });

  it("fails the auth check when the auth probe itself times out", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      if (opts.command === "claude") return okResult({ timedOut: true });
      return okResult({ stdout: "PONG" });
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeEntry = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeEntry?.authCheck.ok).toBe(false);
    expect(claudeEntry?.authCheck.error).toContain("Auth probe timed out after");
  });

  it("fails the codex (hasPong) auth check when PONG is absent even with exit code 0", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ stdout: "no response" });
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codexEntry = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexEntry?.authCheck.ok).toBe(false);
    expect(codexEntry?.authCheck.error).toContain("did not return expected response");
  });

  it("fails the codex auth check with an exit-code message when exit is non-zero and PONG is absent", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ exitCode: 1, stderr: "boom", stdout: "" });
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codexEntry = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexEntry?.authCheck.ok).toBe(false);
    expect(codexEntry?.authCheck.error).toContain("Exit code 1");
  });

  it("passes the codex auth check when PONG is present even though the exit code is non-zero", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      if (opts.command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      return okResult({ exitCode: 1, stdout: "PONG", stderr: "" });
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });

  it("captures a thrown error from the auth check as a failure", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      if (opts.command === "claude") throw new Error("ECONNRESET");
      return okResult({ stdout: "PONG" });
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeEntry = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeEntry?.authCheck.ok).toBe(false);
    expect(claudeEntry?.authCheck.error).toBe("ECONNRESET");
  });

  it("reports ok:false overall when only one of two required runtimes fails", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version" && opts.command === "codex") {
        return okResult({ exitCode: 1, stderr: "not found" });
      }
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      return okResult({ stdout: '{"loggedIn": true}' });
    });
    const logger = makeMockLogger();
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult()!;
    expect(result.ok).toBe(false);
    expect(result.results.find((r) => r.runtime === "claude-code")?.binaryCheck.ok).toBe(true);
    expect(result.results.find((r) => r.runtime === "codex")?.binaryCheck.ok).toBe(false);
  });
});

describe("RuntimeHealthCheck — non-Error rejections are stringified", () => {
  it("stringifies a non-Error value thrown from the binary (version) probe", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version" && opts.command === "claude") {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "raw-binary-failure";
      }
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      configs,
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeEntry = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeEntry?.binaryCheck.error).toBe("raw-binary-failure");
  });

  it("stringifies a non-Error value thrown from the auth probe", async () => {
    const execute = vi.fn(async (opts: { command: string; args: string[] }) => {
      if (opts.args[0] === "--version") return okResult({ stdout: "1.0.0" });
      if (opts.command === "claude") {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "raw-auth-failure";
      }
      return okResult({ stdout: "PONG" });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      configs,
      makeMockLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeEntry = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeEntry?.authCheck.error).toBe("raw-auth-failure");
  });
});

describe("RuntimeHealthCheck — cursor's exitCodeOnly auth branch (probed directly)", () => {
  // No AGENT_STAGES entry uses "cursor" today, so runPreflight() never probes it.
  // Exercise the exitCodeOnly branch directly via the private probeRuntime method
  // to cover this runtime-config variant without altering production wiring.
  let execute: ReturnType<typeof vi.fn>;
  let check: RuntimeHealthCheck;

  beforeEach(() => {
    execute = vi.fn();
    check = new RuntimeHealthCheck({ execute } as never, configs, makeMockLogger() as never);
  });

  it("passes when the binary and status-probe both exit 0", async () => {
    execute.mockResolvedValueOnce(okResult({ stdout: "cursor 9.9.9" }));
    execute.mockResolvedValueOnce(okResult({ exitCode: 0, stdout: "logged in" }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const probeResult = await (check as any).probeRuntime("cursor");
    expect(probeResult.binaryCheck.ok).toBe(true);
    expect(probeResult.authCheck.ok).toBe(true);
  });

  it("fails when the status probe exits non-zero", async () => {
    execute.mockResolvedValueOnce(okResult({ stdout: "cursor 9.9.9" }));
    execute.mockResolvedValueOnce(okResult({ exitCode: 3, stderr: "not logged in" }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const probeResult = await (check as any).probeRuntime("cursor");
    expect(probeResult.authCheck.ok).toBe(false);
    expect(probeResult.authCheck.error).toContain("Exit code 3");
    expect(probeResult.authCheck.error).toContain("not logged in");
  });

  it("falls back to stdout in the error message when stderr is empty", async () => {
    execute.mockResolvedValueOnce(okResult({ stdout: "cursor 9.9.9" }));
    execute.mockResolvedValueOnce(okResult({ exitCode: 2, stdout: "denied", stderr: "" }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const probeResult = await (check as any).probeRuntime("cursor");
    expect(probeResult.authCheck.error).toContain("denied");
  });
});
