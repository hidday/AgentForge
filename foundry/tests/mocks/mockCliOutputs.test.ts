import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function makeOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 60000,
    stdinData: "",
    ...overrides,
  };
}

/** Extracts and parses the JSON payload between the structured-output markers. */
function extractStructuredJson(stdout: string): { success: boolean; stage: string; payload: unknown } {
  expect(stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
  expect(stdout).toContain(STRUCTURED_OUTPUT_END);
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  const jsonText = stdout.slice(start, end).trim();
  return JSON.parse(jsonText) as { success: boolean; stage: string; payload: unknown };
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape for any call", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions());

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
  });

  describe("claude command routing", () => {
    it("routes stdin containing 'answer-researcher' to the answer-researcher payload", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "You are the answer-researcher agent." }),
      );
      const parsed = extractStructuredJson(result.stdout);
      expect(parsed.stage).toBe("answer-researcher");
      expect(parsed.success).toBe(true);
      expect(parsed.payload).toMatchObject({ answers: expect.any(Array) });
    });

    it("routes stdin containing 'open questions to research' to the answer-researcher payload", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ stdinData: "Here are the Open Questions To Research for this run." }),
      );
      const parsed = extractStructuredJson(result.stdout);
      expect(parsed.stage).toBe("answer-researcher");
    });

    it("routes stdin containing 'plan-reviser' to the plan-reviser payload", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ stdinData: "You are the plan-reviser." }));
      const parsed = extractStructuredJson(result.stdout);
      expect(parsed.stage).toBe("plan-reviser");
      expect(parsed.payload).toMatchObject({
        revision: expect.any(Object),
        revisedPlan: expect.any(Object),
      });
    });

    it("routes stdin containing 'lead engineer' to the plan-reviser payload", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ stdinData: "Acting as lead engineer." }));
      const parsed = extractStructuredJson(result.stdout);
      expect(parsed.stage).toBe("plan-reviser");
    });

    it("routes stdin containing 'planner' to the planner payload", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ stdinData: "You are the planner agent." }));
      const parsed = extractStructuredJson(result.stdout);
      expect(parsed.stage).toBe("planner");
      expect(parsed.payload).toMatchObject({ planVersion: 1, steps: expect.any(Array) });
    });

    it("routes stdin containing 'implementation plan' to the planner payload", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ stdinData: "Produce an implementation plan." }));
      const parsed = extractStructuredJson(result.stdout);
      expect(parsed.stage).toBe("planner");
    });

    it("routes stdin containing 'remediat' to the remediation payload", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ stdinData: "Perform remediation on findings." }));
      const parsed = extractStructuredJson(result.stdout);
      expect(parsed.stage).toBe("remediation");
      expect(parsed.payload).toMatchObject({
        resolution: expect.any(Array),
        readyForHumanReview: true,
      });
    });

    it("falls back to the executor payload for unmatched claude stdin content", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ stdinData: "Implement the approved plan." }));
      const parsed = extractStructuredJson(result.stdout);
      expect(parsed.stage).toBe("executor");
      expect(parsed.payload).toMatchObject({ filesChanged: expect.any(Array), score: expect.any(Number) });
    });

    it("recognizes a command that merely ends with 'claude' (e.g. an absolute path)", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "/usr/local/bin/claude", stdinData: "planner task" }),
      );
      const parsed = extractStructuredJson(result.stdout);
      expect(parsed.stage).toBe("planner");
    });

    it("is case-insensitive when matching stdin routing keywords", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ stdinData: "REMEDIATION requested" }));
      const parsed = extractStructuredJson(result.stdout);
      expect(parsed.stage).toBe("remediation");
    });
  });

  describe("codex command routing", () => {
    it("routes stdin containing 'plan review' to the plan-reviewer payload", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "codex", stdinData: "Conduct a plan review of this plan." }),
      );
      const parsed = extractStructuredJson(result.stdout);
      expect(parsed.stage).toBe("plan-reviewer");
      expect(parsed.payload).toMatchObject({ overallVerdict: "changes_requested" });
    });

    it("routes stdin containing 'plan-reviewer' or 'plan under review' to the plan-reviewer payload", async () => {
      const handler = createMockProcessHandler();
      const r1 = await handler(makeOptions({ command: "codex", stdinData: "act as plan-reviewer" }));
      expect(extractStructuredJson(r1.stdout).stage).toBe("plan-reviewer");

      const handler2 = createMockProcessHandler();
      const r2 = await handler2(makeOptions({ command: "codex", stdinData: "the plan under review is X" }));
      expect(extractStructuredJson(r2.stdout).stage).toBe("plan-reviewer");
    });

    it("returns changes_requested on the first code-review call and approved on the second", async () => {
      const handler = createMockProcessHandler();
      const first = await handler(makeOptions({ command: "codex", stdinData: "review this code" }));
      const second = await handler(makeOptions({ command: "codex", stdinData: "review this code" }));

      const firstParsed = extractStructuredJson(first.stdout);
      const secondParsed = extractStructuredJson(second.stdout);

      expect(firstParsed.stage).toBe("reviewer");
      expect(firstParsed.payload).toMatchObject({ overallVerdict: "changes_requested" });
      expect(secondParsed.stage).toBe("reviewer");
      expect(secondParsed.payload).toMatchObject({ overallVerdict: "approved" });
    });

    it("keeps returning approved on subsequent calls after the second", async () => {
      const handler = createMockProcessHandler();
      await handler(makeOptions({ command: "codex", stdinData: "review this code" }));
      await handler(makeOptions({ command: "codex", stdinData: "review this code" }));
      const third = await handler(makeOptions({ command: "codex", stdinData: "review this code" }));

      expect(extractStructuredJson(third.stdout).payload).toMatchObject({
        overallVerdict: "approved",
      });
    });

    it("tracks code-review call count independently per handler instance", async () => {
      const handlerA = createMockProcessHandler();
      const handlerB = createMockProcessHandler();

      const aFirst = await handlerA(makeOptions({ command: "codex", stdinData: "review" }));
      const bFirst = await handlerB(makeOptions({ command: "codex", stdinData: "review" }));

      expect(extractStructuredJson(aFirst.stdout).payload).toMatchObject({
        overallVerdict: "changes_requested",
      });
      expect(extractStructuredJson(bFirst.stdout).payload).toMatchObject({
        overallVerdict: "changes_requested",
      });
    });

    it("recognizes a command that merely ends with 'codex'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "/usr/bin/codex", stdinData: "plan review please" }),
      );
      expect(extractStructuredJson(result.stdout).stage).toBe("plan-reviewer");
    });
  });

  describe("unrecognized command routing", () => {
    it("returns a failure planner payload for a command that is neither claude nor codex", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ command: "cursor", stdinData: "anything" }));
      const parsed = extractStructuredJson(result.stdout);
      expect(parsed.success).toBe(false);
      expect(parsed.stage).toBe("planner");
      expect(parsed.payload).toEqual({});
    });
  });

  it("handles missing stdinData (undefined) without throwing", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ command: "claude", stdinData: undefined }));
    const parsed = extractStructuredJson(result.stdout);
    expect(parsed.stage).toBe("executor");
  });
});
