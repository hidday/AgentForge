import { describe, it, expect, vi } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult, ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function okResult(stdout: string, overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout, stderr: "", exitCode: 0, durationMs: 5, timedOut: false, ...overrides };
}

/**
 * claude-code and codex are probed concurrently (Promise.all), so the order in
 * which `execute` is invoked across runtimes is not guaranteed. Route by
 * command + whether this is the version probe (--version) vs the auth probe,
 * rather than relying on call order.
 */
function makeRoutedExecute(routes: {
  claudeVersion?: ProcessResult | (() => ProcessResult);
  claudeAuth?: ProcessResult | (() => ProcessResult);
  codexVersion?: ProcessResult | (() => ProcessResult);
  codexAuth?: ProcessResult | (() => ProcessResult);
}) {
  const resolve = (v: ProcessResult | (() => ProcessResult) | undefined): ProcessResult => {
    if (!v) throw new Error("No route configured for this call");
    return typeof v === "function" ? v() : v;
  };

  return vi.fn((options: ProcessSpawnOptions) => {
    const isVersion = options.args.includes("--version");
    if (options.command === "claude") {
      return Promise.resolve(resolve(isVersion ? routes.claudeVersion : routes.claudeAuth));
    }
    if (options.command === "codex") {
      return Promise.resolve(resolve(isVersion ? routes.codexVersion : routes.codexAuth));
    }
    throw new Error(`Unexpected command: ${options.command}`);
  });
}

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds configs with the expected commands, probe args, and success conditions", () => {
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

describe("RuntimeHealthCheck.getRequiredRuntimes", () => {
  it("returns the distinct set of runtimes referenced by AGENT_STAGES", () => {
    const processRunner = { execute: vi.fn() };
    const configs = RuntimeHealthCheck.buildRuntimeConfigs(
      "claude",
      [],
      "codex",
      ["exec", "-"],
      "agent",
    );
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    const required = check.getRequiredRuntimes();
    expect(required.has("claude-code")).toBe(true);
    expect(required.has("codex")).toBe(true);
    // No stage currently routes to "cursor".
    expect(required.has("cursor")).toBe(false);
  });
});

describe("RuntimeHealthCheck.runPreflight", () => {
  const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");

  it("resolves ok=true when all required runtimes pass binary and auth checks", async () => {
    const execute = makeRoutedExecute({
      claudeVersion: okResult("1.2.3"),
      claudeAuth: okResult('{"loggedIn": true}'),
      codexVersion: okResult("0.5.0"),
      codexAuth: okResult("PONG"),
    });
    const processRunner = { execute };
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect([...result.requiredRuntimes].sort()).toEqual(["claude-code", "codex"]);
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(check.getLastResult()).toBe(result);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("throws PreflightError and sets ok=false when a binary check fails", async () => {
    const execute = makeRoutedExecute({
      claudeVersion: okResult("", { exitCode: 127, stderr: "command not found" }),
      codexVersion: okResult("0.5.0"),
      codexAuth: okResult("PONG"),
    });
    const processRunner = { execute };
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    expect(logger.error).toHaveBeenCalledTimes(1);

    // authCheck should be skipped (never probed) when binary check fails.
    const lastResult = check.getLastResult();
    expect(lastResult?.ok).toBe(false);
    const claudeResult = lastResult?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toContain("Exit code 127");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toBe("Skipped: binary check failed");
  });

  it("throws PreflightError when binary check passes but auth check fails", async () => {
    const execute = makeRoutedExecute({
      claudeVersion: okResult("1.2.3"),
      claudeAuth: okResult('{"loggedIn": false}'),
      codexVersion: okResult("0.5.0"),
      codexAuth: okResult("PONG"),
    });
    const processRunner = { execute };
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(processRunner as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const lastResult = check.getLastResult();
    const claudeResult = lastResult?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(true);
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("Auth check failed");
  });

  it("marks binary check timed out as failed with a descriptive error", async () => {
    const execute = makeRoutedExecute({
      claudeVersion: okResult("", { timedOut: true }),
      codexVersion: okResult("0.5.0"),
      codexAuth: okResult("PONG"),
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toBe("Timed out after 5000ms");
  });

  it("marks binary check failed when the process execute call itself throws", async () => {
    const execute = vi.fn((options: ProcessSpawnOptions) => {
      if (options.command === "claude") return Promise.reject(new Error("spawn ENOENT"));
      if (options.args.includes("--version")) return Promise.resolve(okResult("0.5.0"));
      return Promise.resolve(okResult("PONG"));
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toBe("spawn ENOENT");
  });

  it("marks auth check failed when the auth probe times out", async () => {
    const execute = makeRoutedExecute({
      claudeVersion: okResult("1.2.3"),
      claudeAuth: okResult("", { timedOut: true }),
      codexVersion: okResult("0.5.0"),
      codexAuth: okResult("PONG"),
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toBe("Auth probe timed out after 30000ms");
  });

  it("marks auth check failed when the auth probe throws", async () => {
    const execute = vi.fn((options: ProcessSpawnOptions) => {
      if (options.command === "claude" && !options.args.includes("--version")) {
        return Promise.reject(new Error("pipe broke"));
      }
      if (options.command === "claude") return Promise.resolve(okResult("1.2.3"));
      if (options.args.includes("--version")) return Promise.resolve(okResult("0.5.0"));
      return Promise.resolve(okResult("PONG"));
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toBe("pipe broke");
  });

  it("fails codex auth check when neither pong nor exit code 0 is present", async () => {
    const execute = makeRoutedExecute({
      claudeVersion: okResult("1.2.3"),
      claudeAuth: okResult('{"loggedIn": true}'),
      codexVersion: okResult("0.5.0"),
      codexAuth: okResult("garbage output", { exitCode: 1, stderr: "bad request" }),
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("Exit code 1");
  });

  it("fails codex auth check when exit code is 0 but no pong is present", async () => {
    const execute = makeRoutedExecute({
      claudeVersion: okResult("1.2.3"),
      claudeAuth: okResult('{"loggedIn": true}'),
      codexVersion: okResult("0.5.0"),
      codexAuth: okResult("no response marker here"),
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("did not return expected response");
  });

  it("passes codex auth check on exit code != 0 as long as pong is present", async () => {
    const execute = makeRoutedExecute({
      claudeVersion: okResult("1.2.3"),
      claudeAuth: okResult('{"loggedIn": true}'),
      codexVersion: okResult("0.5.0"),
      codexAuth: okResult("some warning\nPONG", { exitCode: 1 }),
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    const result = await check.runPreflight();
    const codexResult = result.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(true);
  });

  it("passes an exitCodeOnly auth check on exit code 0 regardless of output content", async () => {
    const exitCodeOnlyConfigs = {
      ...configs,
      "claude-code": { ...configs["claude-code"], successPattern: undefined, exitCodeOnly: true },
    };
    const execute = makeRoutedExecute({
      claudeVersion: okResult("1.2.3"),
      claudeAuth: okResult("irrelevant output", { exitCode: 0 }),
      codexVersion: okResult("0.5.0"),
      codexAuth: okResult("PONG"),
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      exitCodeOnlyConfigs,
      makeLogger() as never,
    );

    const result = await check.runPreflight();
    const claudeResult = result.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(true);
  });

  it("fails an exitCodeOnly auth check on non-zero exit with a descriptive error", async () => {
    const exitCodeOnlyConfigs = {
      ...configs,
      "claude-code": { ...configs["claude-code"], successPattern: undefined, exitCodeOnly: true },
    };
    const execute = makeRoutedExecute({
      claudeVersion: okResult("1.2.3"),
      claudeAuth: okResult("", { exitCode: 1, stderr: "not authorized" }),
      codexVersion: okResult("0.5.0"),
      codexAuth: okResult("PONG"),
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(
      processRunner as never,
      exitCodeOnlyConfigs,
      makeLogger() as never,
    );

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("Exit code 1");
    expect(claudeResult?.authCheck.error).toContain("not authorized");
  });
});
