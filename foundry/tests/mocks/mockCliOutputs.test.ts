import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
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
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  const json = stdout.slice(start, end).trim();
  return JSON.parse(json) as { success: boolean; stage: string; payload: unknown };
}

describe("createMockProcessHandler", () => {
  it("returns a ProcessResult shape with exitCode 0 and timedOut false for any call", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions());

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(typeof result.durationMs).toBe("number");
    expect(typeof result.stdout).toBe("string");
  });

  describe("claude command routing by stdin content", () => {
    it.each([
      ["answer-researcher", "answer-researcher"],
      ["open questions to research", "answer-researcher"],
      ["plan revision", "plan-reviser"],
      ["plan-reviser", "plan-reviser"],
      ["lead engineer", "plan-reviser"],
      ["planner", "planner"],
      ["implementation plan", "planner"],
      ["remediat", "remediation"],
    ] as const)("routes stdin containing %s to the %s mock output", async (keyword) => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "claude", stdinData: `Some ${keyword} task` }));
      const parsed = extractPayload(result.stdout);
      expect(parsed.success).toBe(true);
    });

    it("defaults to the executor mock output when no keyword matches", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "implement the feature" }),
      );
      const parsed = extractPayload(result.stdout);
      expect(parsed.stage).toBe("executor");
    });

    it("matches planner output for 'implementation plan' and plan-reviser output for 'plan revision'", async () => {
      const handler = createMockProcessHandler();
      const plannerResult = await handler(
        baseOptions({ command: "claude", stdinData: "Create the implementation plan" }),
      );
      const plannerPayload = extractPayload(plannerResult.stdout);
      expect(plannerPayload.stage).toBe("planner");

      const reviserResult = await handler(
        baseOptions({ command: "claude", stdinData: "handle the plan revision" }),
      );
      const reviserPayload = extractPayload(reviserResult.stdout);
      expect(reviserPayload.stage).toBe("plan-reviser");
    });

    it("recognizes 'claude' as an exact command match (not just a suffix)", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "claude", stdinData: "remediat the bug" }));
      const parsed = extractPayload(result.stdout);
      expect(parsed.stage).toBe("remediation");
    });

    it("recognizes a command path ending in /claude as claude", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/claude", stdinData: "planner task" }),
      );
      const parsed = extractPayload(result.stdout);
      expect(parsed.stage).toBe("planner");
    });
  });

  describe("codex command routing", () => {
    it("routes plan-review keywords to the plan-reviewer mock output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "Running the plan-reviewer stage" }),
      );
      const parsed = extractPayload(result.stdout);
      expect(parsed.stage).toBe("plan-reviewer");
    });

    it("returns changes_requested on the first code-review call and approved on the second", async () => {
      const handler = createMockProcessHandler();

      const first = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
      const firstPayload = extractPayload(first.stdout) as { payload: { overallVerdict: string } };
      expect(firstPayload.payload.overallVerdict).toBe("changes_requested");

      const second = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
      const secondPayload = extractPayload(second.stdout) as { payload: { overallVerdict: string } };
      expect(secondPayload.payload.overallVerdict).toBe("approved");
    });

    it("keeps independent call counters per handler instance", async () => {
      const handlerA = createMockProcessHandler();
      const handlerB = createMockProcessHandler();

      const aFirst = await handlerA(baseOptions({ command: "codex", stdinData: "review" }));
      const bFirst = await handlerB(baseOptions({ command: "codex", stdinData: "review" }));

      expect((extractPayload(aFirst.stdout) as { payload: { overallVerdict: string } }).payload.overallVerdict).toBe(
        "changes_requested",
      );
      expect((extractPayload(bFirst.stdout) as { payload: { overallVerdict: string } }).payload.overallVerdict).toBe(
        "changes_requested",
      );
    });
  });

  it("returns a failure planner payload for an unrecognized command", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "some-other-tool" }));
    const parsed = extractPayload(result.stdout);
    expect(parsed.success).toBe(false);
    expect(parsed.stage).toBe("planner");
    expect(parsed.payload).toEqual({});
  });

  it("treats missing stdinData as an empty string without throwing", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "claude", stdinData: undefined }));
    const parsed = extractPayload(result.stdout);
    // No keyword matches on empty input, so it falls through to the executor default.
    expect(parsed.stage).toBe("executor");
  });
});
