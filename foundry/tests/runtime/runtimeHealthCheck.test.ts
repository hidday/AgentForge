import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeHealthCheck } from "../../src/runtime/runtimeHealthCheck.js";
import { PreflightError } from "../../src/utils/errors.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";
import * as domainTypes from "../../src/domain/types.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeProcessRunner() {
  return { execute: vi.fn() };
}

function ok(stdout = "", stderr = "", exitCode = 0): ProcessResult {
  return { stdout, stderr, exitCode, durationMs: 5, timedOut: false };
}

const runtimeConfigs = RuntimeHealthCheck.buildRuntimeConfigs("claude", [], "codex", [], "cursor");

describe("RuntimeHealthCheck.buildRuntimeConfigs", () => {
  it("builds a config per runtime with the expected probe shapes", () => {
    expect(runtimeConfigs["claude-code"]).toMatchObject({
      command: "claude",
      versionArgs: ["--version"],
      probeArgs: ["auth", "status"],
      successPattern: '"loggedIn":\\s*true',
    });
    expect(runtimeConfigs.codex).toMatchObject({
      command: "codex",
      versionArgs: ["--version"],
      probeArgs: [],
      probeStdin: "Respond with exactly: PONG",
    });
    expect(runtimeConfigs.cursor).toMatchObject({
      command: "cursor",
      versionArgs: ["--version"],
      probeArgs: ["status"],
      exitCodeOnly: true,
    });
  });
});

describe("RuntimeHealthCheck.getRequiredRuntimes", () => {
  it("returns the distinct set of runtimes used across all agent stages", () => {
    const processRunner = makeProcessRunner();
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(processRunner as never, runtimeConfigs, logger as never);

    const required = check.getRequiredRuntimes();
    const expected = new Set(Object.values(domainTypes.AGENT_STAGES).map((s) => s.runtime));
    expect(required).toEqual(expected);
  });
});

describe("RuntimeHealthCheck.getLastResult", () => {
  it("returns undefined before any preflight has run", () => {
    const processRunner = makeProcessRunner();
    const logger = makeLogger();
    const check = new RuntimeHealthCheck(processRunner as never, runtimeConfigs, logger as never);
    expect(check.getLastResult()).toBeUndefined();
  });
});

describe("RuntimeHealthCheck.runPreflight", () => {
  let processRunner: ReturnType<typeof makeProcessRunner>;
  let logger: ReturnType<typeof makeLogger>;
  let check: RuntimeHealthCheck;

  beforeEach(() => {
    processRunner = makeProcessRunner();
    logger = makeLogger();
    check = new RuntimeHealthCheck(processRunner as never, runtimeConfigs, logger as never);
  });

  it("passes when every required runtime's binary and auth checks succeed", async () => {
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return ok(`${command} v1.0.0`);
      if (command === "claude") return ok('{"loggedIn": true}');
      if (command === "cursor") return ok();
      return ok("PONG received");
    });

    const result = await check.runPreflight();

    expect(result.ok).toBe(true);
    // "cursor" is not used by any configured AGENT_STAGES entry, so it's
    // never required/probed even though its runtime config exists.
    expect(result.requiredRuntimes.sort()).toEqual(["claude-code", "codex"].sort());
    expect(result.skippedRuntimes).toEqual(["cursor"]);
    expect(result.results).toHaveLength(2);
    expect(check.getLastResult()).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalDurationMs: expect.any(Number) }),
      "Preflight passed: all agent runtimes are accessible and authenticated",
    );
  });

  it("throws PreflightError and logs failures when a binary check fails", async () => {
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (command === "claude" && args.includes("--version")) {
        return ok("", "command not found", 127);
      }
      if (args.includes("--version")) return ok(`${command} v1.0.0`);
      if (command === "cursor") return ok();
      return ok("PONG");
    });

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);

    const result = check.getLastResult();
    expect(result?.ok).toBe(false);
    const claudeResult = result?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(false);
    expect(claudeResult?.binaryCheck.error).toContain("Exit code 127");
    // Auth check is skipped entirely when the binary check fails.
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toBe("Skipped: binary check failed");
    expect(processRunner.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ args: ["auth", "status"] }),
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ runtime: "claude-code" }),
        ]),
      }),
      "Preflight FAILED: one or more agent runtimes are not ready",
    );
  });

  it("throws PreflightError when a binary check times out", async () => {
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (command === "codex" && args.includes("--version")) {
        return { stdout: "", stderr: "", exitCode: 0, durationMs: 5000, timedOut: true };
      }
      if (args.includes("--version")) return ok(`${command} v1.0.0`);
      if (command === "cursor") return ok();
      return ok("PONG");
    });

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const result = check.getLastResult();
    const codexResult = result?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.binaryCheck.ok).toBe(false);
    expect(codexResult?.binaryCheck.error).toBe("Timed out after 5000ms");
  });

  it("stringifies a non-Error thrown from the binary check", async () => {
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (command === "codex" && args.includes("--version")) {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "codex binary check string failure";
      }
      if (args.includes("--version")) return ok(`${command} v1.0.0`);
      if (command === "claude") return ok('{"loggedIn": true}');
      return ok("PONG");
    });

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.binaryCheck.error).toBe("codex binary check string failure");
  });

  it("marks binary check failed when the process throws (spawn error)", async () => {
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (command === "codex" && args.includes("--version")) {
        throw new Error("spawn codex ENOENT");
      }
      if (args.includes("--version")) return ok(`${command} v1.0.0`);
      if (command === "claude") return ok('{"loggedIn": true}');
      return ok("PONG");
    });

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.binaryCheck.ok).toBe(false);
    expect(codexResult?.binaryCheck.error).toBe("spawn codex ENOENT");
  });

  it("fails auth check via successPattern when the expected pattern is absent", async () => {
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return ok(`${command} v1.0.0`);
      if (command === "claude") return ok('{"loggedIn": false}');
      if (command === "cursor") return ok();
      return ok("PONG");
    });

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.binaryCheck.ok).toBe(true);
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("expected pattern not found");
  });

  it("passes auth check via successPattern when it matches stderr instead of stdout", async () => {
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return ok(`${command} v1.0.0`);
      if (command === "claude") return ok("", '{"loggedIn": true}');
      if (command === "cursor") return ok();
      return ok("PONG");
    });

    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });

  it("passes PONG-based auth check (codex) on exit 0 with pong in output", async () => {
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return ok(`${command} v1.0.0`);
      if (command === "claude") return ok('{"loggedIn": true}');
      if (command === "cursor") return ok();
      return ok("PONG!", "", 0);
    });

    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });

  it("passes PONG-based auth check even on non-zero exit, as long as pong is present", async () => {
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return ok(`${command} v1.0.0`);
      if (command === "claude") return ok('{"loggedIn": true}');
      if (command === "cursor") return ok();
      // Codex CLI can exit non-zero after echoing, but still answered — should pass.
      return ok("pong", "warning: deprecated", 1);
    });

    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
  });

  it("fails PONG-based auth check on non-zero exit with no pong in output", async () => {
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return ok(`${command} v1.0.0`);
      if (command === "claude") return ok('{"loggedIn": true}');
      if (command === "cursor") return ok();
      return ok("", "fatal error", 2);
    });

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("Exit code 2");
  });

  it("fails PONG-based auth check on exit 0 without pong in output", async () => {
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return ok(`${command} v1.0.0`);
      if (command === "claude") return ok('{"loggedIn": true}');
      if (command === "cursor") return ok();
      return ok("something else entirely", "", 0);
    });

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const codexResult = check.getLastResult()?.results.find((r) => r.runtime === "codex");
    expect(codexResult?.authCheck.ok).toBe(false);
    expect(codexResult?.authCheck.error).toContain("did not return expected response");
  });

  it("fails auth check when the auth probe times out", async () => {
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return ok(`${command} v1.0.0`);
      if (command === "claude") {
        return { stdout: "", stderr: "", exitCode: 0, durationMs: 30_000, timedOut: true };
      }
      if (command === "cursor") return ok();
      return ok("PONG");
    });

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toContain("Auth probe timed out after 30000ms");
  });

  it("marks auth check failed when the auth probe process throws", async () => {
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return ok(`${command} v1.0.0`);
      if (command === "claude") throw new Error("auth probe crashed");
      if (command === "cursor") return ok();
      return ok("PONG");
    });

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.ok).toBe(false);
    expect(claudeResult?.authCheck.error).toBe("auth probe crashed");
  });

  it("stringifies a non-Error thrown from the auth probe", async () => {
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return ok(`${command} v1.0.0`);
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      if (command === "claude") throw "auth probe string failure";
      if (command === "cursor") return ok();
      return ok("PONG");
    });

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const claudeResult = check.getLastResult()?.results.find((r) => r.runtime === "claude-code");
    expect(claudeResult?.authCheck.error).toBe("auth probe string failure");
  });

  it("passes stdinData through to the auth probe when configured (codex)", async () => {
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return ok(`${command} v1.0.0`);
      if (command === "claude") return ok('{"loggedIn": true}');
      if (command === "cursor") return ok();
      return ok("PONG");
    });

    await check.runPreflight();

    const codexAuthCall = processRunner.execute.mock.calls.find(
      ([opts]) => opts.command === "codex" && !opts.args.includes("--version"),
    );
    expect(codexAuthCall?.[0]).toMatchObject({ stdinData: "Respond with exactly: PONG" });
  });

  it("skips runtimes not required by any configured agent stage", async () => {
    // Restrict the health check to a single runtime by giving a config map
    // that RuntimeHealthCheck consults via getRequiredRuntimes(), but since
    // getRequiredRuntimes derives from AGENT_STAGES (not overridable here),
    // we instead assert the skipped list is the complement of the required set.
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return ok(`${command} v1.0.0`);
      if (command === "claude") return ok('{"loggedIn": true}');
      if (command === "cursor") return ok();
      return ok("PONG");
    });

    const result = await check.runPreflight();
    const allRuntimes = ["claude-code", "codex", "cursor"];
    for (const runtime of result.skippedRuntimes) {
      expect(allRuntimes).toContain(runtime);
      expect(result.requiredRuntimes).not.toContain(runtime);
    }
  });
});
