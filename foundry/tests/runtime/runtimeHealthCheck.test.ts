import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function okResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout: "", stderr: "", exitCode: 0, durationMs: 5, timedOut: false, ...overrides };
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds a config keyed by runtime with the expected shape per runtime", () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      ["--print"],
      "codex",
      ["exec", "-"],
      "agent",
    );

    expect(configs["claude-code"]).toEqual({
      command: "claude",
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });
    expect(configs.codex).toEqual({
      command: "codex",
      versionArgs: ["--version"],
      probeArgs: ["exec", "-"],
      probeStdin: "Respond with exactly: PONG",
    });
    expect(configs.cursor).toEqual({
      command: "agent",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes / getLastResult", () => {
  it("derives the required runtime set from AGENT_STAGES (claude-code and codex, but not cursor)", () => {
    const processRunner = { execute: vi.fn() };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec"], "agent");
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    const required = check.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    expect(required.has("cursor")).toBe(false);
  });

  it("returns undefined from getLastResult before any preflight has run", () => {
    const processRunner = { execute: vi.fn() };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec"], "agent");
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight", () => {
  function setup() {
    const processRunner = { execute: vi.fn() };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    return { processRunner, configs, logger, check };
  }

  it("passes and caches the result when every required runtime's binary and auth checks succeed", async () => {
    const { processRunner, logger, check } = setup();
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return okResult({ stdout: "1.2.3\n" });
      if (command === "claude") return okResult({ stdout: '{"loggedIn": true}' });
      // codex probe
      return okResult({ stdout: "chatter PONG done" });
    });

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(typeof result.totalDurationMs).toBe("number");
    expect(check.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("throws PreflightError and logs failures when a runtime is not ready", async () => {
    const { processRunner, logger, check } = setup();
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return okResult({ stdout: "1.2.3\n" });
      if (command === "claude") return okResult({ stdout: '{"loggedIn": false}' });
      return okResult({ stdout: "chatter PONG done" });
    });

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: [
          expect.objectContaining({ runtime: "claude-code", authError: expect.any(String) }),
        ],
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
    // The failed result is still cached even though the call rejects.
    expect(check.getLastResult()?.ok).toBe(false);
  });

  it("skips the auth check and reports it failed when the binary check fails", async () => {
    const { processRunner, check } = setup();
    processRunner.execute.mockImplementation(async ({ args }) => {
      if (args.includes("--version")) return okResult({ exitCode: 127, stderr: "not found" });
      throw new Error("auth probe should not run when binary check failed");
    });

    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);

    const lastResult = check.getLastResult();
    for (const probe of lastResult?.results ?? []) {
      expect(probe.binaryCheck.ok).toBe(false);
      expect(probe.authCheck.ok).toBe(false);
      expect(probe.authCheck.error).toBe("Skipped: binary check failed");
    }
  });
});

describe("RuntimeHealthCheck binary/auth probe branches", () => {
  // Drive probeRuntime()/checkBinary()/checkAuth() directly through runPreflight,
  // but restrict getRequiredRuntimes() by only asserting on the single runtime's
  // entry within the results array (the other required runtime is stubbed to pass).

  async function runSingleProbe(
    executeImpl: (opts: { command: string; args: string[]; stdinData?: string }) => Promise<ProcessResult>,
  ) {
    const processRunner = { execute: vi.fn(executeImpl) };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    try {
      await check.runPreflight();
    } catch {
      // some scenarios are expected to throw PreflightError; we inspect getLastResult() instead.
    }
    return check.getLastResult()!;
  }

  it("checkBinary: marks ok:false when the version probe times out", async () => {
    const result = await runSingleProbe(async ({ args }) => {
      if (args.includes("--version")) return okResult({ timedOut: true });
      return okResult({ stdout: '{"loggedIn": true}' });
    });
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(false);
    expect(claude.binaryCheck.error).toBe("Timed out after 5000ms");
  });

  it("checkBinary: marks ok:false with exit-code/stderr detail on non-zero exit", async () => {
    const result = await runSingleProbe(async ({ args }) => {
      if (args.includes("--version")) return okResult({ exitCode: 3, stderr: "boom" });
      return okResult({ stdout: '{"loggedIn": true}' });
    });
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(false);
    expect(claude.binaryCheck.error).toBe("Exit code 3: boom");
  });

  it("checkBinary: extracts and truncates the first line of stdout as the version on success", async () => {
    const longVersion = "v" + "9".repeat(150);
    const result = await runSingleProbe(async ({ args }) => {
      if (args.includes("--version")) return okResult({ stdout: `${longVersion}\nextra line` });
      return okResult({ stdout: '{"loggedIn": true}' });
    });
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(true);
    expect(claude.binaryCheck.version).toBe(longVersion.slice(0, 100));
    expect(claude.binaryCheck.version?.length).toBe(100);
  });

  it("checkBinary: catches a thrown Error from execute and reports its message", async () => {
    const result = await runSingleProbe(async ({ args }) => {
      if (args.includes("--version")) throw new Error("ENOENT: no such binary");
      return okResult({ stdout: '{"loggedIn": true}' });
    });
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(false);
    expect(claude.binaryCheck.error).toBe("ENOENT: no such binary");
  });

  it("checkBinary: catches a thrown non-Error value and stringifies it", async () => {
    const result = await runSingleProbe(async ({ args }) => {
      if (args.includes("--version")) throw "raw string failure";
      return okResult({ stdout: '{"loggedIn": true}' });
    });
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.binaryCheck.ok).toBe(false);
    expect(claude.binaryCheck.error).toBe("raw string failure");
  });

  it("checkAuth: marks ok:false when the auth probe times out", async () => {
    const result = await runSingleProbe(async ({ args, stdinData }) => {
      if (args.includes("--version")) return okResult();
      if (args.includes("auth")) return okResult({ timedOut: true });
      return okResult({ stdout: `echo:${stdinData}` });
    });
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toBe("Auth probe timed out after 30000ms");
  });

  it("checkAuth: successPattern matches -> ok, and includes stdin data for the PONG-style probe", async () => {
    const result = await runSingleProbe(async ({ args, stdinData }) => {
      if (args.includes("--version")) return okResult();
      if (args.includes("auth")) return okResult({ stdout: '{"loggedIn":true}' });
      return okResult({ stdout: `saw stdin "${stdinData}" -> PONG` });
    });
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    const codex = result.results.find((r) => r.runtime === "codex")!;
    expect(claude.authCheck.ok).toBe(true);
    expect(codex.authCheck.ok).toBe(true);
  });

  it("checkAuth: successPattern configured but not found in stdout/stderr -> ok:false", async () => {
    const result = await runSingleProbe(async ({ args }) => {
      if (args.includes("--version")) return okResult();
      if (args.includes("auth")) return okResult({ stdout: '{"loggedIn":false}' });
      return okResult({ stdout: "PONG" });
    });
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toContain("expected pattern not found in output");
  });

  it("checkAuth: exitCodeOnly true and exitCode 0 -> ok, non-zero -> ok:false with stderr/stdout detail", async () => {
    // cursor uses exitCodeOnly; it's not in the required set by default, so probe it directly
    // by constructing a RuntimeHealthCheck whose only configured runtime is cursor-shaped logic
    // via buildRuntimeConfigs, exercised through checkAuth's private path indirectly is not
    // possible without adding cursor to AGENT_STAGES, so we assert via claude-code/codex only
    // and instead verify the exitCodeOnly branch using a bespoke config for a runtime already
    // required (codex) by overriding its config to use exitCodeOnly semantics.
    const processRunner = {
      execute: vi.fn(async ({ args }: { args: string[] }) => {
        if (args.includes("--version")) return okResult();
        return okResult({ exitCode: 0, stdout: "" });
      }),
    };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    configs.codex.exitCodeOnly = true;
    delete configs.codex.probeStdin;
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);
    // Also cover claude-code's successPattern branch alongside in the same run.
    processRunner.execute.mockImplementation(async ({ command, args }: { command: string; args: string[] }) => {
      if (args.includes("--version")) return okResult();
      if (command === "claude") return okResult({ stdout: '{"loggedIn":true}' });
      return okResult({ exitCode: 0, stdout: "" });
    });

    const result = await check.runPreflight();
    const codex = result.results.find((r) => r.runtime === "codex")!;
    expect(codex.authCheck.ok).toBe(true);

    // Now flip to a non-zero exit and re-run to hit the exitCodeOnly failure branch.
    processRunner.execute.mockImplementation(async ({ command, args }: { command: string; args: string[] }) => {
      if (args.includes("--version")) return okResult();
      if (command === "claude") return okResult({ stdout: '{"loggedIn":true}' });
      return okResult({ exitCode: 5, stderr: "denied" });
    });
    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const codexFailed = check.getLastResult()!.results.find((r) => r.runtime === "codex")!;
    expect(codexFailed.authCheck.ok).toBe(false);
    expect(codexFailed.authCheck.error).toBe("Exit code 5: denied");

    // When stderr is empty, the error detail falls back to stdout.
    processRunner.execute.mockImplementation(async ({ command, args }: { command: string; args: string[] }) => {
      if (args.includes("--version")) return okResult();
      if (command === "claude") return okResult({ stdout: '{"loggedIn":true}' });
      return okResult({ exitCode: 7, stderr: "", stdout: "stdout-detail" });
    });
    await expect(check.runPreflight()).rejects.toBeInstanceOf(PreflightError);
    const codexStdoutFallback = check.getLastResult()!.results.find((r) => r.runtime === "codex")!;
    expect(codexStdoutFallback.authCheck.ok).toBe(false);
    expect(codexStdoutFallback.authCheck.error).toBe("Exit code 7: stdout-detail");
  });

  it("checkAuth: no successPattern/exitCodeOnly, no PONG in output and non-zero exit -> exit-code error", async () => {
    const result = await runSingleProbe(async ({ command, args }) => {
      if (args.includes("--version")) return okResult();
      if (command === "claude") return okResult({ stdout: '{"loggedIn":true}' });
      return okResult({ exitCode: 2, stderr: "nope" });
    });
    const codex = result.results.find((r) => r.runtime === "codex")!;
    expect(codex.authCheck.ok).toBe(false);
    expect(codex.authCheck.error).toBe("Exit code 2: nope");
  });

  it("checkAuth: no successPattern/exitCodeOnly, no PONG but exit code 0 -> 'did not return expected response'", async () => {
    const result = await runSingleProbe(async ({ command, args }) => {
      if (args.includes("--version")) return okResult();
      if (command === "claude") return okResult({ stdout: '{"loggedIn":true}' });
      return okResult({ exitCode: 0, stdout: "no expected token here" });
    });
    const codex = result.results.find((r) => r.runtime === "codex")!;
    expect(codex.authCheck.ok).toBe(false);
    expect(codex.authCheck.error).toContain("did not return expected response");
  });

  it("checkAuth: PONG present even with non-zero exit code -> ok:true", async () => {
    const result = await runSingleProbe(async ({ command, args }) => {
      if (args.includes("--version")) return okResult();
      if (command === "claude") return okResult({ stdout: '{"loggedIn":true}' });
      return okResult({ exitCode: 1, stdout: "PONG anyway" });
    });
    const codex = result.results.find((r) => r.runtime === "codex")!;
    expect(codex.authCheck.ok).toBe(true);
  });

  it("checkAuth: catches a thrown error from execute and reports its message", async () => {
    const result = await runSingleProbe(async ({ command, args }) => {
      if (args.includes("--version")) return okResult();
      if (command === "claude") throw new Error("auth probe crashed");
      return okResult({ stdout: "PONG" });
    });
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toBe("auth probe crashed");
  });

  it("checkAuth: catches a thrown non-Error value and stringifies it", async () => {
    const result = await runSingleProbe(async ({ command, args }) => {
      if (args.includes("--version")) return okResult();
      if (command === "claude") throw { weird: "object" };
      return okResult({ stdout: "PONG" });
    });
    const claude = result.results.find((r) => r.runtime === "claude-code")!;
    expect(claude.authCheck.ok).toBe(false);
    expect(claude.authCheck.error).toBe("[object Object]");
  });
});
