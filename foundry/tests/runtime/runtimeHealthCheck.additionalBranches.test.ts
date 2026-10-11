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

function makeRoutedExecute(routes: {
  claudeVersion?: ProcessResult | (() => ProcessResult) | (() => Promise<ProcessResult>);
  claudeAuth?: ProcessResult | (() => ProcessResult);
  codexVersion?: ProcessResult | (() => ProcessResult);
  codexAuth?: ProcessResult | (() => ProcessResult);
}) {
  const resolve = (v: unknown): Promise<ProcessResult> => {
    if (!v) throw new Error("No route configured for this call");
    return typeof v === "function" ? Promise.resolve((v as () => ProcessResult)()) : Promise.resolve(v as ProcessResult);
  };

  return vi.fn((options: ProcessSpawnOptions) => {
    const isVersion = options.args.includes("--version");
    if (options.command === "claude") {
      return resolve(isVersion ? routes.claudeVersion : routes.claudeAuth);
    }
    if (options.command === "codex") {
      return resolve(isVersion ? routes.codexVersion : routes.codexAuth);
    }
    throw new Error(`Unexpected command: ${options.command}`);
  });
}

describe("RuntimeHealthCheck — non-Error throw branches", () => {
  const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");

  it("stringifies a non-Error thrown by the binary (--version) probe", async () => {
    const execute = vi.fn((options: ProcessSpawnOptions) => {
      if (options.command === "claude") {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        return Promise.reject("binary probe exploded");
      }
      if (options.args.includes("--version")) return Promise.resolve(okResult("0.5.0"));
      return Promise.resolve(okResult("PONG"));
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toBe("binary probe exploded");
  });

  it("stringifies a non-Error thrown by the auth probe", async () => {
    const execute = vi.fn((options: ProcessSpawnOptions) => {
      if (options.command === "claude" && !options.args.includes("--version")) {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        return Promise.reject({ reason: "connection reset" });
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
    expect(claudeResult?.authCheck.error).toBe(String({ reason: "connection reset" }));
  });

  it("falls back to stdout in the exitCodeOnly error message when stderr is empty", async () => {
    const exitCodeOnlyConfigs = {
      ...configs,
      "claude-code": { ...configs["claude-code"], successPattern: undefined, exitCodeOnly: true },
    };
    const execute = makeRoutedExecute({
      claudeVersion: okResult("1.2.3"),
      claudeAuth: okResult("permission denied: not logged in", { exitCode: 1, stderr: "" }),
      codexVersion: okResult("0.5.0"),
      codexAuth: okResult("PONG"),
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, exitCodeOnlyConfigs, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("permission denied: not logged in");
  });
});

describe("RuntimeHealthCheck — authError ternary in the failures summary (documented as unreachable)", () => {
  // `probeRuntime` always forces `authCheck.ok = false` whenever `binaryCheck.ok`
  // is false (it short-circuits before even attempting the auth probe). Because
  // of that, within `runPreflight`'s `failures` map, any result that got there
  // via a failing binaryCheck will *always* also have authCheck.ok === false.
  // The `authError: r.authCheck.ok ? undefined : r.authCheck.error` ternary's
  // "authCheck.ok === true" branch can therefore never be reached through the
  // public API -- it is defensive code for a combination `probeRuntime` cannot
  // currently produce. We don't force it with brittle internal reflection;
  // this test just documents the invariant that makes it unreachable.
  it("a failing binaryCheck always implies authCheck.ok === false in the probe result", async () => {
    const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", ["exec", "-"], "agent");
    const execute = makeRoutedExecute({
      claudeVersion: okResult("", { exitCode: 127, stderr: "not found" }),
      codexVersion: okResult("0.5.0"),
      codexAuth: okResult("PONG"),
    });
    const processRunner = { execute };
    const check = new RuntimeHealthCheck(processRunner as never, configs, makeLogger() as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toBe("Skipped: binary check failed");
  });
});
