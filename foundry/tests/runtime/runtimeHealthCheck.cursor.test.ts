import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

// The "cursor" runtime config supports `exitCodeOnly` auth checks, but no
// AGENT_STAGES entry actually uses the cursor runtime, so runPreflight()
// never probes it in the real app. To exercise that branch we inject a
// fake cursor-using stage into AGENT_STAGES for this file only.
vi.mock("../../src/domain/types.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/domain/types.js")>();
  return {
    ...actual,
    AGENT_STAGES: {
      ...actual.AGENT_STAGES,
      cursorStage: { runtime: "cursor" as const, name: "cursor-stage" },
    },
  };
});

const { RuntimeHealthCheck } = await import("../../src/runtime/runtimeHealthCheck.js");
const { PreflightError } = await import("../../src/utils/errors.js");

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

describe("RuntimeHealthCheck: cursor exitCodeOnly auth probe (forced required)", () => {
  let processRunner: ReturnType<typeof makeProcessRunner>;
  let logger: ReturnType<typeof makeLogger>;
  let check: InstanceType<typeof RuntimeHealthCheck>;

  beforeEach(() => {
    processRunner = makeProcessRunner();
    logger = makeLogger();
    check = new RuntimeHealthCheck(processRunner as never, runtimeConfigs, logger as never);
  });

  it("includes cursor among the required runtimes given the injected stage", () => {
    expect(check.getRequiredRuntimes().has("cursor")).toBe(true);
  });

  it("fails auth check via exitCodeOnly when exit code is non-zero", async () => {
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return ok(`${command} v1.0.0`);
      if (command === "claude") return ok('{"loggedIn": true}');
      if (command === "codex") return ok("PONG");
      return ok("", "not logged in", 1);
    });

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const cursorResult = check.getLastResult()?.results.find((r) => r.runtime === "cursor");
    expect(cursorResult?.authCheck.ok).toBe(false);
    expect(cursorResult?.authCheck.error).toContain("Exit code 1");
    expect(cursorResult?.authCheck.error).toContain("not logged in");
  });

  it("falls back to stdout in the error message when stderr is empty", async () => {
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return ok(`${command} v1.0.0`);
      if (command === "claude") return ok('{"loggedIn": true}');
      if (command === "codex") return ok("PONG");
      return ok("stdout failure detail", "", 1);
    });

    await expect(check.runPreflight()).rejects.toThrow(PreflightError);
    const cursorResult = check.getLastResult()?.results.find((r) => r.runtime === "cursor");
    expect(cursorResult?.authCheck.error).toContain("Exit code 1");
    expect(cursorResult?.authCheck.error).toContain("stdout failure detail");
  });

  it("passes auth check via exitCodeOnly on exit code 0 regardless of output", async () => {
    processRunner.execute.mockImplementation(async ({ command, args }) => {
      if (args.includes("--version")) return ok(`${command} v1.0.0`);
      if (command === "claude") return ok('{"loggedIn": true}');
      if (command === "codex") return ok("PONG");
      return ok("anything", "", 0);
    });

    const result = await check.runPreflight();
    expect(result.ok).toBe(true);
    const cursorResult = result.results.find((r) => r.runtime === "cursor");
    expect(cursorResult?.authCheck.ok).toBe(true);
  });
});
