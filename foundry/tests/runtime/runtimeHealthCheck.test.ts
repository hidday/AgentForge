import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as import(
    "../../src/utils/logger.js"
  ).Logger;
}

function makeResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 1, timedOut: false, ...overrides };
}

function makeProcessRunner(
  execute: (options: { command: string; args: string[] }) => Promise<ProcessResult>,
) {
  return { execute: vi.fn(execute) } as unknown as import("../../src/runtime/processRunner.js").ProcessRunner;
}

/**
 * Builds a ProcessRunner where codex's binary and auth checks always pass
 * trivially (via pong-detection), while claude-code's binary check and auth
 * check are controlled independently via `binary`/`auth` — necessary because
 * both checks hit the same `command` ("claude-cmd") and are only
 * distinguishable by args (versionArgs vs probeArgs).
 */
function makeClaudeProbeRunner(
  binary: ProcessResult | (() => ProcessResult | Promise<ProcessResult>),
  auth: ProcessResult | (() => ProcessResult | Promise<ProcessResult>),
) {
  return makeProcessRunner(async (opts) => {
    if (opts.command !== "claude-cmd") {
      return makeResult({ stdout: "PONG" });
    }
    const isBinaryCheck = opts.args.includes("--version");
    const source = isBinaryCheck ? binary : auth;
    return typeof source === "function" ? source() : source;
  });
}

const BASE_CONFIGS = {
  "claude-code": { command: "claude-cmd", versionArgs: ["--version"], probeArgs: [] },
  codex: { command: "codex-cmd", versionArgs: ["--version"], probeArgs: [] },
  cursor: { command: "cursor-cmd", versionArgs: ["--version"], probeArgs: [] },
} as const;

describe("RuntimeHealthCheck.getRequiredRuntimes / getLastResult", () => {
  it("requires only the runtimes actually used by an agent stage (claude-code, codex), not cursor", () => {
    const check = new RuntimeHealthCheck(
      makeProcessRunner(() => Promise.resolve(makeResult())),
      BASE_CONFIGS,
      makeLogger(),
    );
    const required = check.getRequiredRuntimes();
    expect(required).toEqual(new Set(["claude-code", "codex"]));
    expect(required.has("cursor")).toBe(false);
  });

  it("getLastResult is undefined before any preflight has run", () => {
    const check = new RuntimeHealthCheck(
      makeProcessRunner(() => Promise.resolve(makeResult())),
      BASE_CONFIGS,
      makeLogger(),
    );
    expect(check.getLastResult()).toBeUndefined();
  });

  it("getLastResult reflects the most recent preflight result", async () => {
    const check = new RuntimeHealthCheck(
      makeProcessRunner(() => Promise.resolve(makeResult({ stdout: "pong" }))),
      {
        "claude-code": { ...BASE_CONFIGS["claude-code"], exitCodeOnly: true },
        codex: { ...BASE_CONFIGS.codex, exitCodeOnly: true },
        cursor: BASE_CONFIGS.cursor,
      },
      makeLogger(),
    );
    const result = await check.runPreflight();
    expect(check.getLastResult()).toBe(result);
  });
});

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds a config per runtime with the expected auth-probe strategy", () => {
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

describe("RuntimeHealthCheck.runPreflight - aggregate outcomes", () => {
  it("resolves ok:true and logs success when every required runtime's binary and auth checks pass", async () => {
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(
      makeProcessRunner((opts) =>
        Promise.resolve(
          opts.command === "claude-cmd"
            ? makeResult({ stdout: '{"loggedIn": true}' })
            : makeResult({ stdout: "PONG received" }),
        ),
      ),
      {
        "claude-code": { ...BASE_CONFIGS["claude-code"], successPattern: '"loggedIn":\\s*true' },
        codex: BASE_CONFIGS.codex,
        cursor: BASE_CONFIGS.cursor,
      },
      logger,
    );

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("skips the auth check and fails fast when the binary check fails, and throws PreflightError with failure details", async () => {
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(
      makeProcessRunner((opts) =>
        opts.command === "claude-cmd"
          ? Promise.resolve(makeResult({ exitCode: 127, stderr: "command not found" }))
          : Promise.resolve(makeResult({ stdout: "PONG" })),
      ),
      BASE_CONFIGS,
      logger,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    try {
      await check.runPreflight();
    } catch (err) {
      const preflightErr = err as PreflightError;
      expect(preflightErr.message).toContain("claude-code");
      expect(preflightErr.result.ok).toBe(false);
      const claudeResult = preflightErr.result.results.find((r) => r.runtime === "claude-code");
      expect(claudeResult?.binaryCheck.ok).toBe(false);
      expect(claudeResult?.authCheck).toEqual({
        ok: false,
        durationMs: 0,
        error: "Skipped: binary check failed",
      });
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
});

describe("RuntimeHealthCheck - checkBinary branches (via runPreflight)", () => {
  it("marks the binary check failed on timeout", async () => {
    const check = new RuntimeHealthCheck(
      makeProcessRunner((opts) =>
        Promise.resolve(
          opts.command === "claude-cmd"
            ? makeResult({ timedOut: true })
            : makeResult({ stdout: "PONG" }),
        ),
      ),
      BASE_CONFIGS,
      makeLogger(),
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult();
    const claude = result?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.binaryCheck.ok).toBe(false);
    expect(claude?.binaryCheck.error).toContain("Timed out after");
  });

  it("marks the binary check failed on a non-zero exit code, including stderr", async () => {
    const check = new RuntimeHealthCheck(
      makeProcessRunner((opts) =>
        Promise.resolve(
          opts.command === "claude-cmd"
            ? makeResult({ exitCode: 1, stderr: "boom" })
            : makeResult({ stdout: "PONG" }),
        ),
      ),
      BASE_CONFIGS,
      makeLogger(),
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.binaryCheck.error).toBe("Exit code 1: boom");
  });

  it("extracts the version from the first line of stdout on success", async () => {
    const check = new RuntimeHealthCheck(
      makeClaudeProbeRunner(
        makeResult({ stdout: "v1.2.3\nextra ignored line" }),
        makeResult({ stdout: "PONG" }),
      ),
      BASE_CONFIGS,
      makeLogger(),
    );

    const result = await check.runPreflight();
    const claude = result.results.find((r) => r.runtime === "claude-code");
    expect(claude?.binaryCheck.ok).toBe(true);
    expect(claude?.binaryCheck.version).toBe("v1.2.3");
  });

  it("catches a thrown Error from the process runner and records its message", async () => {
    const check = new RuntimeHealthCheck(
      makeProcessRunner((opts) =>
        opts.command === "claude-cmd"
          ? Promise.reject(new Error("spawn failed"))
          : Promise.resolve(makeResult({ stdout: "PONG" })),
      ),
      BASE_CONFIGS,
      makeLogger(),
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.binaryCheck.error).toBe("spawn failed");
  });

  it("stringifies a non-Error throwable from the process runner", async () => {
    const check = new RuntimeHealthCheck(
      makeProcessRunner((opts) =>
        opts.command === "claude-cmd"
          ? Promise.reject("not-an-error")
          : Promise.resolve(makeResult({ stdout: "PONG" })),
      ),
      BASE_CONFIGS,
      makeLogger(),
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.binaryCheck.error).toBe("not-an-error");
  });
});

describe("RuntimeHealthCheck - checkAuth branches (via runPreflight)", () => {
  function configsWith(claudeOverrides: Record<string, unknown>) {
    return {
      "claude-code": { ...BASE_CONFIGS["claude-code"], ...claudeOverrides },
      codex: BASE_CONFIGS.codex,
      cursor: BASE_CONFIGS.cursor,
    };
  }

  const PASSING_BINARY = makeResult({ stdout: "v1.0.0" });

  it("fails when the auth probe times out", async () => {
    const check = new RuntimeHealthCheck(
      makeClaudeProbeRunner(PASSING_BINARY, makeResult({ timedOut: true })),
      configsWith({}),
      makeLogger(),
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.authCheck.error).toContain("Auth probe timed out");
  });

  it("passes when successPattern matches stdout", async () => {
    const check = new RuntimeHealthCheck(
      makeClaudeProbeRunner(PASSING_BINARY, makeResult({ stdout: '{"loggedIn": true}' })),
      configsWith({ successPattern: '"loggedIn":\\s*true' }),
      makeLogger(),
    );

    const result = await check.runPreflight();
    expect(result.results.find((r) => r.runtime === "claude-code")?.authCheck.ok).toBe(true);
  });

  it("fails when successPattern does not match", async () => {
    const check = new RuntimeHealthCheck(
      makeClaudeProbeRunner(PASSING_BINARY, makeResult({ stdout: '{"loggedIn": false}' })),
      configsWith({ successPattern: '"loggedIn":\\s*true' }),
      makeLogger(),
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.authCheck.error).toContain("expected pattern not found");
  });

  it("passes with exitCodeOnly when exit code is 0", async () => {
    const check = new RuntimeHealthCheck(
      makeClaudeProbeRunner(PASSING_BINARY, makeResult({ exitCode: 0 })),
      configsWith({ exitCodeOnly: true }),
      makeLogger(),
    );

    const result = await check.runPreflight();
    expect(result.results.find((r) => r.runtime === "claude-code")?.authCheck.ok).toBe(true);
  });

  it("fails with exitCodeOnly when exit code is non-zero", async () => {
    const check = new RuntimeHealthCheck(
      makeClaudeProbeRunner(PASSING_BINARY, makeResult({ exitCode: 1, stderr: "not logged in" })),
      configsWith({ exitCodeOnly: true }),
      makeLogger(),
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.authCheck.error).toBe("Exit code 1: not logged in");
  });

  it("falls back to pong-detection and passes when exit code is 0 and output contains pong", async () => {
    const check = new RuntimeHealthCheck(
      makeClaudeProbeRunner(PASSING_BINARY, makeResult({ exitCode: 0, stdout: "PONG" })),
      configsWith({}),
      makeLogger(),
    );

    const result = await check.runPreflight();
    expect(result.results.find((r) => r.runtime === "claude-code")?.authCheck.ok).toBe(true);
  });

  it("pong-detection fails via exit code when exit code is non-zero and no pong is present", async () => {
    const check = new RuntimeHealthCheck(
      makeClaudeProbeRunner(PASSING_BINARY, makeResult({ exitCode: 1, stderr: "auth error" })),
      configsWith({}),
      makeLogger(),
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.authCheck.error).toBe("Exit code 1: auth error");
  });

  it("pong-detection fails on exit code 0 with no pong in the output", async () => {
    const check = new RuntimeHealthCheck(
      makeClaudeProbeRunner(PASSING_BINARY, makeResult({ exitCode: 0, stdout: "unexpected output" })),
      configsWith({}),
      makeLogger(),
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.authCheck.error).toContain("did not return expected response");
  });

  it("catches a thrown Error from the auth probe and records its message", async () => {
    const check = new RuntimeHealthCheck(
      makeClaudeProbeRunner(PASSING_BINARY, () => Promise.reject(new Error("auth probe crashed"))),
      configsWith({}),
      makeLogger(),
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.authCheck.error).toBe("auth probe crashed");
  });

  it("stringifies a non-Error throwable from the auth probe", async () => {
    const check = new RuntimeHealthCheck(
      makeClaudeProbeRunner(PASSING_BINARY, () => Promise.reject("not-an-error")),
      configsWith({}),
      makeLogger(),
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claude = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claude?.authCheck.error).toBe("not-an-error");
  });
});
