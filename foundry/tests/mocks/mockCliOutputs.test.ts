import { describe, it, expect, beforeEach } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import {
  STRUCTURED_OUTPUT_BEGIN,
  STRUCTURED_OUTPUT_END,
} from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 1000,
    ...overrides,
  };
}

function extractPayload(stdout: string): { success: boolean; stage: string; payload: unknown } {
  expect(stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
  expect(stdout).toContain(STRUCTURED_OUTPUT_END);
  const json = stdout.split(STRUCTURED_OUTPUT_BEGIN)[1]!.split(STRUCTURED_OUTPUT_END)[0]!.trim();
  return JSON.parse(json);
}

describe("createMockProcessHandler", () => {
  let handler: (options: ProcessSpawnOptions) => Promise<import("../../src/runtime/runnerTypes.js").ProcessResult>;

  beforeEach(() => {
    handler = createMockProcessHandler();
  });

  it("returns a well-formed ProcessResult shape", async () => {
    const result = await handler(baseOptions({ stdinData: "planner implementation plan" }));
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
  });

  describe("claude command routing", () => {
    it.each([
      ["answer-researcher", "answer-researcher"],
      ["Open Questions To Research", "answer-researcher"],
      ["plan revision", "plan-reviser"],
      ["plan-reviser", "plan-reviser"],
      ["lead engineer", "plan-reviser"],
      ["planner", "planner"],
      ["implementation plan", "planner"],
      ["remediation needed", "remediation"],
    ] as const)("stdin containing %j routes to stage %s", async (needle, expectedStage) => {
      const result = await handler(baseOptions({ command: "claude", stdinData: needle }));
      const payload = extractPayload(result.stdout);
      expect(payload.success).toBe(true);
      expect(payload.stage).toBe(expectedStage);
    });

    it("is case-insensitive when matching stdin keywords", async () => {
      const result = await handler(baseOptions({ command: "claude", stdinData: "PLANNER STAGE" }));
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("planner");
    });

    it("falls back to the executor output when no keyword matches", async () => {
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "nothing recognizable here" }),
      );
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("executor");
    });

    it("falls back to the executor output when stdinData is omitted entirely", async () => {
      const result = await handler(baseOptions({ command: "claude", stdinData: undefined }));
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("executor");
    });

    it("matches a command path ending in 'claude' (not just the literal 'claude')", async () => {
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/claude", stdinData: "planner" }),
      );
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("planner");
    });
  });

  describe("codex command routing", () => {
    it("routes plan-review keywords to the plan reviewer output", async () => {
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "the plan under review is attached" }),
      );
      const payload = extractPayload(result.stdout) as { stage: string; payload: { overallVerdict: string } };
      expect(payload.stage).toBe("plan-reviewer");
      expect(payload.payload.overallVerdict).toBe("changes_requested");
    });

    it("alternates code-review verdicts: first call changes_requested, second call approved", async () => {
      const first = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
      const second = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));

      const firstPayload = extractPayload(first.stdout) as {
        stage: string;
        payload: { overallVerdict: string };
      };
      const secondPayload = extractPayload(second.stdout) as {
        stage: string;
        payload: { overallVerdict: string };
      };

      expect(firstPayload.stage).toBe("reviewer");
      expect(firstPayload.payload.overallVerdict).toBe("changes_requested");
      expect(secondPayload.stage).toBe("reviewer");
      expect(secondPayload.payload.overallVerdict).toBe("approved");
    });

    it("keeps separate call counters per handler instance", async () => {
      const first = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
      expect((extractPayload(first.stdout) as { payload: { overallVerdict: string } }).payload.overallVerdict).toBe(
        "changes_requested",
      );

      const freshHandler = createMockProcessHandler();
      const freshFirst = await freshHandler(
        baseOptions({ command: "codex", stdinData: "review this diff" }),
      );
      expect(
        (extractPayload(freshFirst.stdout) as { payload: { overallVerdict: string } }).payload
          .overallVerdict,
      ).toBe("changes_requested");
    });

    it("matches a command path ending in 'codex'", async () => {
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/codex", stdinData: "plan-reviewer" }),
      );
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("plan-reviewer");
    });
  });

  describe("unknown command routing", () => {
    it("returns a failure envelope for a command that is neither claude nor codex", async () => {
      const result = await handler(baseOptions({ command: "cursor", stdinData: "anything" }));
      const payload = extractPayload(result.stdout);
      expect(payload.success).toBe(false);
      expect(payload.stage).toBe("planner");
      expect(payload.payload).toEqual({});
      expect(result.exitCode).toBe(0);
    });
  });
});
