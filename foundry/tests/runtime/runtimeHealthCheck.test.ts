import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 10,
    timedOut: false,
    ...overrides,
  };
}

const configs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "cursor");

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds a config entry for every runtime with the given commands", () => {
    expect(configs["claude-code"].command).toBe("claude");
    expect(configs.codex.command).toBe("codex");
    expect(configs.cursor.command).toBe("cursor");
  });

  it("configures claude-code with a successPattern auth check (no exitCodeOnly)", () => {
    expect(configs["claude-code"].successPattern).toBeDefined();
    expect(configs["claude-code"].exitCodeOnly).toBeUndefined();
  });

  it("configures cursor with exitCodeOnly auth check (no successPattern)", () => {
    expect(configs.cursor.exitCodeOnly).toBe(true);
    expect(configs.cursor.successPattern).toBeUndefined();
  });

  it("configures codex with a PONG probeStdin and no successPattern/exitCodeOnly", () => {
    expect(configs.codex.probeStdin).toContain("PONG");
    expect(configs.codex.successPattern).toBeUndefined();
    expect(configs.codex.exitCodeOnly).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes", () => {
  it("returns the set of runtimes actually used by configured agent stages", () => {
    const logger = makeLogger();
    const check = new RuntimeHealthCheck({ execute: vi.fn() } as never, configs, logger as never);
    const required = check.getRequiredRuntimes();
    expect(required.size).toBeGreaterThan(0);
    for (const r of required) {
      expect(["claude-code", "codex", "cursor"]).toContain(r);
    }
  });
});

describe("RuntimeHealthCheck.getLastResult", () => {
  it("returns undefined before runPreflight has ever run", () => {
    const logger = makeLogger();
    const check = new RuntimeHealthCheck({ execute: vi.fn() } as never, configs, logger as never);
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight", () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  it("resolves ok=true and caches the result when every required runtime's binary+auth checks pass", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return makeResult({ stdout: "v1.0.0\n" });
      if (opts.args.includes("status")) return makeResult({ exitCode: 0 }); // cursor exitCodeOnly
      if (opts.args.includes("auth")) return makeResult({ stdout: '{"loggedIn": true}' }); // claude-code
      return makeResult({ stdout: "PONG" }); // codex
    });
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    expect(result.results.length).toBe(check.getRequiredRuntimes().size);
    expect(check.getLastResult()).toBe(result);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("throws PreflightError and does not resolve when a binary check fails (non-zero exit)", async () => {
    const execute = vi.fn().mockResolvedValue(makeResult({ exitCode: 127, stderr: "not found" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    expect(logger.error).toHaveBeenCalled();
  });

  it("skips the auth check and reports it failed when the binary check fails", async () => {
    const execute = vi.fn().mockResolvedValue(makeResult({ exitCode: 1, stderr: "boom" }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    try {
      await check.runPreflight();
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightError);
      const summary = (err as PreflightError).result;
      for (const r of summary.results) {
        expect(r.authCheck.ok).toBe(false);
        expect(r.authCheck.error).toContain("Skipped");
      }
    }
  });

  it("reports a binary check as failed with a 'Timed out' message when the version probe times out", async () => {
    const execute = vi.fn().mockResolvedValue(makeResult({ timedOut: true }));
    const check = new RuntimeHealthCheck({ execute } as never, configs, logger as never);

    try {
      await check.runPreflight();
      expect.fail("expected throw");
    } catch (err) {
      const summary = (err as PreflightError).result;
      expect(summary.results[0]!.binaryCheck.ok).toBe(false);
      expect(summary.results[0]!.binaryCheck.error).toContain("Timed out");
    }
  });

  it("marks the auth check failed when the successPattern regex does not match stdout/stderr", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return makeResult({ stdout: "v1" });
      return makeResult({ stdout: '{"loggedIn": false}' });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      { "claude-code": configs["claude-code"] } as never,
      logger as never,
    );

    try {
      await check.runPreflight();
      expect.fail("expected throw");
    } catch (err) {
      const summary = (err as PreflightError).result;
      const cc = summary.results.find((r) => r.runtime === "claude-code")!;
      expect(cc.authCheck.ok).toBe(false);
      expect(cc.authCheck.error).toContain("expected pattern not found");
    }
  });

  it("marks the auth check failed on non-zero exit when exitCodeOnly is set", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return makeResult({ stdout: "v1" });
      return makeResult({ exitCode: 2, stderr: "bad" });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      { cursor: configs.cursor } as never,
      logger as never,
    );

    try {
      await check.runPreflight();
      expect.fail("expected throw");
    } catch (err) {
      const summary = (err as PreflightError).result;
      const cursor = summary.results.find((r) => r.runtime === "cursor")!;
      expect(cursor.authCheck.ok).toBe(false);
      expect(cursor.authCheck.error).toContain("Exit code 2");
    }
  });

  it("passes exitCodeOnly auth check on exit code 0 regardless of output content", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return makeResult({ stdout: "v1" });
      return makeResult({ exitCode: 0, stdout: "anything" });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      { cursor: configs.cursor } as never,
      logger as never,
    );

    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });

  it("marks default (PONG-style) auth check failed when neither exit code 0 nor a pong-like response is seen", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return makeResult({ stdout: "v1" });
      return makeResult({ exitCode: 1, stdout: "garbage", stderr: "bad" });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      { codex: configs.codex } as never,
      logger as never,
    );

    try {
      await check.runPreflight();
      expect.fail("expected throw");
    } catch (err) {
      const summary = (err as PreflightError).result;
      const codex = summary.results.find((r) => r.runtime === "codex")!;
      expect(codex.authCheck.ok).toBe(false);
      expect(codex.authCheck.error).toContain("Exit code 1");
    }
  });

  it("passes default auth check on non-zero exit code if a 'pong' response is present", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return makeResult({ stdout: "v1" });
      return makeResult({ exitCode: 1, stdout: "PONG", stderr: "" });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      { codex: configs.codex } as never,
      logger as never,
    );

    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });

  it("marks default auth check failed when exit code is 0 but no pong-like response is present", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return makeResult({ stdout: "v1" });
      return makeResult({ exitCode: 0, stdout: "no pong here" });
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      { codex: configs.codex } as never,
      logger as never,
    );

    try {
      await check.runPreflight();
      expect.fail("expected throw");
    } catch (err) {
      const summary = (err as PreflightError).result;
      const codex = summary.results.find((r) => r.runtime === "codex")!;
      expect(codex.authCheck.ok).toBe(false);
      expect(codex.authCheck.error).toContain("did not return expected response");
    }
  });

  it("reports the auth check failed with the caught error message when execute() throws during auth probe", async () => {
    const execute = vi.fn().mockImplementation(async (opts: { args: string[] }) => {
      if (opts.args.includes("--version")) return makeResult({ stdout: "v1" });
      throw new Error("ECONNREFUSED");
    });
    const check = new RuntimeHealthCheck(
      { execute } as never,
      { codex: configs.codex } as never,
      logger as never,
    );

    try {
      await check.runPreflight();
      expect.fail("expected throw");
    } catch (err) {
      const summary = (err as PreflightError).result;
      const codex = summary.results.find((r) => r.runtime === "codex")!;
      expect(codex.authCheck.ok).toBe(false);
      expect(codex.authCheck.error).toBe("ECONNREFUSED");
    }
  });

  it("reports the binary check failed with the caught error message when execute() throws during version probe", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("ENOENT: spawn failed"));
    const check = new RuntimeHealthCheck(
      { execute } as never,
      { codex: configs.codex } as never,
      logger as never,
    );

    try {
      await check.runPreflight();
      expect.fail("expected throw");
    } catch (err) {
      const summary = (err as PreflightError).result;
      expect(summary.results[0]!.binaryCheck.ok).toBe(false);
      expect(summary.results[0]!.binaryCheck.error).toBe("ENOENT: spawn failed");
    }
  });
});
