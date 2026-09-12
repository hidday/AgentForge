import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function processResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 5,
    timedOut: false,
    ...overrides,
  };
}

const claudeConfig = {
  command: "claude",
  versionArgs: ["--version"],
  probeArgs: ["auth", "status"],
  successPattern: '"loggedIn":\\s*true',
};

const codexConfig = {
  command: "codex",
  versionArgs: ["--version"],
  probeArgs: ["exec", "-"],
  probeStdin: "Respond with exactly: PONG",
};

const cursorConfig = {
  command: "cursor-agent",
  versionArgs: ["--version"],
  probeArgs: ["status"],
  exitCodeOnly: true,
};

function makeHealthCheck(execute: (opts: unknown) => Promise<ProcessResult>) {
  const processRunner = { execute: vi.fn(execute) };
  const logger = makeLogger();
  const configs: Record<AgentRuntime, typeof claudeConfig | typeof codexConfig | typeof cursorConfig> = {
    "claude-code": claudeConfig,
    codex: codexConfig,
    cursor: cursorConfig,
  };
  const rhc = new RuntimeHealthCheck(processRunner as never, configs as never, logger as never);
  return { rhc, processRunner, logger };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds a config per runtime with the expected probe wiring", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      [],
      "codex",
      ["exec", "-"],
      "cursor-agent",
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
      command: "cursor-agent",
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes / getLastResult", () => {
  it("derives required runtimes from AGENT_STAGES, excluding cursor which no stage uses", () => {
    const { rhc } = makeHealthCheck(async () => processResult());
    const required = rhc.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });

  it("returns undefined before any preflight has run", () => {
    const { rhc } = makeHealthCheck(async () => processResult());
    expect(rhc.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight", () => {
  it("passes when every required runtime's binary and auth checks succeed, and records skipped runtimes", async () => {
    const { rhc, logger } = makeHealthCheck(async (opts: unknown) => {
      const { args } = opts as { args: string[] };
      if (args[0] === "--version") return processResult({ stdout: "1.2.3\n" });
      if (args.includes("status")) return processResult({ stdout: '{"loggedIn": true}' });
      return processResult({ stdout: "PONG" });
    });

    const result = await rhc.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(rhc.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("fails and throws PreflightError when a required runtime's binary check fails, skipping its auth check", async () => {
    const { rhc, logger } = makeHealthCheck(async (opts: unknown) => {
      const { command, args } = opts as { command: string; args: string[] };
      if (command === "claude" && args[0] === "--version") {
        return processResult({ exitCode: 127, stderr: "command not found" });
      }
      if (args[0] === "--version") return processResult({ stdout: "1.0.0" });
      return processResult({ stdout: "PONG" });
    });

    await expect(rhc.runPreflight()).rejects.toThrow(PreflightError);

    const result = rhc.getLastResult();
    expect(result?.ok).toBe(false);
    const claudeProbe = result?.results.find((r) => r.runtime === "claude-code");
    expect(claudeProbe?.binaryCheck.ok).toBe(false);
    expect(claudeProbe?.authCheck.ok).toBe(false);
    expect(claudeProbe?.authCheck.error).toBe("Skipped: binary check failed");
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ runtime: "claude-code" }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("includes an undefined binaryError but a defined authError for a runtime whose binary passes but auth fails", async () => {
    const { rhc, logger } = makeHealthCheck(async (opts: unknown) => {
      const { command, args } = opts as { command: string; args: string[] };
      if (args[0] === "--version") return processResult({ stdout: "1.0.0" });
      if (command === "claude") return processResult({ stdout: '{"loggedIn": false}' });
      return processResult({ stdout: "PONG" });
    });

    await expect(rhc.runPreflight()).rejects.toThrow(PreflightError);

    const result = rhc.getLastResult()!;
    const claudeProbe = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claudeProbe.binaryCheck.ok).toBe(true);
    expect(claudeProbe.authCheck.ok).toBe(false);

    // logger.error's `failures` mapping: binaryError is undefined (binary passed)
    // while authError carries the real auth failure message.
    const [logFields] = logger.error.mock.calls[0]!;
    const claudeFailure = logFields.failures.find(
      (f: { runtime: string }) => f.runtime === "claude-code",
    );
    expect(claudeFailure.binaryError).toBeUndefined();
    expect(claudeFailure.authError).toContain("expected pattern not found in output");
  });

  it("attaches the full PreflightResult on the thrown PreflightError", async () => {
    const { rhc } = makeHealthCheck(async () => processResult({ exitCode: 1, stderr: "boom" }));

    try {
      await rhc.runPreflight();
      throw new Error("expected runPreflight to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightError);
      const e = err as PreflightError;
      expect(e.result.ok).toBe(false);
      expect(e.message).toContain("Preflight failed for runtimes:");
    }
  });
});

describe("RuntimeHealthCheck binary probe branches (checkBinary via runPreflight)", () => {
  it("reports a timeout error when the version probe times out", async () => {
    const { rhc } = makeHealthCheck(async () => processResult({ timedOut: true }));
    await expect(rhc.runPreflight()).rejects.toThrow(PreflightError);
    const result = rhc.getLastResult()!;
    const probe = result.results.find((r) => r.runtime === "codex")!;
    expect(probe.binaryCheck.ok).toBe(false);
    expect(probe.binaryCheck.error).toBe("Timed out after 5000ms");
  });

  it("reports the exit code and truncated stderr when the binary check exits non-zero", async () => {
    const { rhc } = makeHealthCheck(async () =>
      processResult({ exitCode: 3, stderr: "not installed" }),
    );
    await expect(rhc.runPreflight()).rejects.toThrow(PreflightError);
    const probe = rhc.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(probe.binaryCheck.error).toBe("Exit code 3: not installed");
  });

  it("captures a thrown error from the process runner as the binary check error", async () => {
    const { rhc } = makeHealthCheck(async () => {
      throw new Error("spawn ENOENT");
    });
    await expect(rhc.runPreflight()).rejects.toThrow(PreflightError);
    const probe = rhc.getLastResult()!.results.find((r) => r.runtime === "codex")!;
    expect(probe.binaryCheck.ok).toBe(false);
    expect(probe.binaryCheck.error).toBe("spawn ENOENT");
  });

  it("falls back to String(err) when the process runner throws a non-Error value", async () => {
    const { rhc } = makeHealthCheck(async () => {
      // eslint-disable-next-line no-throw-literal
      throw "plain string failure";
    });
    await expect(rhc.runPreflight()).rejects.toThrow(PreflightError);
    const probe = rhc.getLastResult()!.results.find((r) => r.runtime === "codex")!;
    expect(probe.binaryCheck.error).toBe("plain string failure");
  });

  it("reports ok:true with the first line of stdout truncated to 100 chars as the version", async () => {
    const longVersion = "v" + "9".repeat(150);
    const { rhc } = makeHealthCheck(async (opts: unknown) => {
      const { args } = opts as { args: string[] };
      if (args[0] === "--version") return processResult({ stdout: `${longVersion}\nextra line` });
      return processResult({ stdout: '{"loggedIn": true}\nPONG' });
    });
    await rhc.runPreflight();
    const probe = rhc.getLastResult()!.results.find((r) => r.runtime === "claude-code")!;
    expect(probe.binaryCheck.ok).toBe(true);
    expect(probe.binaryCheck.version).toBe(longVersion.slice(0, 100));
    expect(probe.binaryCheck.version?.length).toBe(100);
  });
});

describe("RuntimeHealthCheck.checkAuth branches (invoked directly for precise coverage)", () => {
  function directHealthCheck(execute: (opts: unknown) => Promise<ProcessResult>) {
    const processRunner = { execute: vi.fn(execute) };
    const logger = makeLogger();
    const rhc = new RuntimeHealthCheck(processRunner as never, {} as never, logger as never);
    return rhc;
  }

  it("passes when successPattern matches the combined stdout+stderr", async () => {
    const rhc = directHealthCheck(async () => processResult({ stdout: '{"loggedIn": true}' }));
    const authCheck = await (rhc as never as { checkAuth: (c: unknown) => Promise<unknown> })[
      "checkAuth"
    ](claudeConfig);
    expect(authCheck).toMatchObject({ ok: true });
  });

  it("fails with a descriptive error when successPattern does not match", async () => {
    const rhc = directHealthCheck(async () => processResult({ stdout: '{"loggedIn": false}' }));
    const authCheck = (await (rhc as never as { checkAuth: (c: unknown) => Promise<never> })[
      "checkAuth"
    ](claudeConfig)) as { ok: boolean; error?: string };
    expect(authCheck.ok).toBe(false);
    expect(authCheck.error).toContain("expected pattern not found in output");
  });

  it("passes on exit code 0 alone when exitCodeOnly is set", async () => {
    const rhc = directHealthCheck(async () => processResult({ exitCode: 0, stdout: "ready" }));
    const authCheck = (await (rhc as never as { checkAuth: (c: unknown) => Promise<never> })[
      "checkAuth"
    ](cursorConfig)) as { ok: boolean };
    expect(authCheck.ok).toBe(true);
  });

  it("fails with the exit code and stderr/stdout tail when exitCodeOnly is set and exit is non-zero", async () => {
    const rhc = directHealthCheck(async () =>
      processResult({ exitCode: 5, stdout: "", stderr: "not authenticated" }),
    );
    const authCheck = (await (rhc as never as { checkAuth: (c: unknown) => Promise<never> })[
      "checkAuth"
    ](cursorConfig)) as { ok: boolean; error?: string };
    expect(authCheck.ok).toBe(false);
    expect(authCheck.error).toBe("Exit code 5: not authenticated");
  });

  it("falls back to stdout in the error message when exitCodeOnly fails with empty stderr", async () => {
    const rhc = directHealthCheck(async () =>
      processResult({ exitCode: 5, stdout: "stdout explanation", stderr: "" }),
    );
    const authCheck = (await (rhc as never as { checkAuth: (c: unknown) => Promise<never> })[
      "checkAuth"
    ](cursorConfig)) as { ok: boolean; error?: string };
    expect(authCheck.ok).toBe(false);
    expect(authCheck.error).toBe("Exit code 5: stdout explanation");
  });

  it("passes for the default (pong) probe style when exit is 0 and output contains pong", async () => {
    const rhc = directHealthCheck(async () => processResult({ exitCode: 0, stdout: "PONG" }));
    const authCheck = (await (rhc as never as { checkAuth: (c: unknown) => Promise<never> })[
      "checkAuth"
    ](codexConfig)) as { ok: boolean };
    expect(authCheck.ok).toBe(true);
  });

  it("passes for the default probe style even on non-zero exit, as long as pong is present", async () => {
    const rhc = directHealthCheck(async () =>
      processResult({ exitCode: 1, stdout: "warning\nPONG\n" }),
    );
    const authCheck = (await (rhc as never as { checkAuth: (c: unknown) => Promise<never> })[
      "checkAuth"
    ](codexConfig)) as { ok: boolean };
    expect(authCheck.ok).toBe(true);
  });

  it("fails for the default probe style on non-zero exit with no pong in output", async () => {
    const rhc = directHealthCheck(async () =>
      processResult({ exitCode: 2, stdout: "", stderr: "auth expired" }),
    );
    const authCheck = (await (rhc as never as { checkAuth: (c: unknown) => Promise<never> })[
      "checkAuth"
    ](codexConfig)) as { ok: boolean; error?: string };
    expect(authCheck.ok).toBe(false);
    expect(authCheck.error).toBe("Exit code 2: auth expired");
  });

  it("fails for the default probe style on exit 0 with no pong in output", async () => {
    const rhc = directHealthCheck(async () => processResult({ exitCode: 0, stdout: "hello" }));
    const authCheck = (await (rhc as never as { checkAuth: (c: unknown) => Promise<never> })[
      "checkAuth"
    ](codexConfig)) as { ok: boolean; error?: string };
    expect(authCheck.ok).toBe(false);
    expect(authCheck.error).toContain("Auth probe did not return expected response");
  });

  it("reports a timeout error for the auth probe", async () => {
    const rhc = directHealthCheck(async () => processResult({ timedOut: true }));
    const authCheck = (await (rhc as never as { checkAuth: (c: unknown) => Promise<never> })[
      "checkAuth"
    ](codexConfig)) as { ok: boolean; error?: string };
    expect(authCheck.ok).toBe(false);
    expect(authCheck.error).toBe("Auth probe timed out after 30000ms");
  });

  it("captures a thrown error from the process runner as the auth check error", async () => {
    const rhc = directHealthCheck(async () => {
      throw new Error("ECONNRESET");
    });
    const authCheck = (await (rhc as never as { checkAuth: (c: unknown) => Promise<never> })[
      "checkAuth"
    ](codexConfig)) as { ok: boolean; error?: string };
    expect(authCheck.ok).toBe(false);
    expect(authCheck.error).toBe("ECONNRESET");
  });

  it("falls back to String(err) when the process runner throws a non-Error value during the auth probe", async () => {
    const rhc = directHealthCheck(async () => {
      // eslint-disable-next-line no-throw-literal
      throw 42;
    });
    const authCheck = (await (rhc as never as { checkAuth: (c: unknown) => Promise<never> })[
      "checkAuth"
    ](codexConfig)) as { ok: boolean; error?: string };
    expect(authCheck.ok).toBe(false);
    expect(authCheck.error).toBe("42");
  });
});
