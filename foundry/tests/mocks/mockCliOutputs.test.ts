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

function extractStage(stdout: string): string {
  const begin = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  const json = JSON.parse(stdout.slice(begin, end).trim()) as { stage: string };
  return json.stage;
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult with structured output delimiters", async () => {
    const handler = createMockProcessHandler();

    const result = await handler(baseOptions({ command: "claude", stdinData: "act as planner" }));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_END);
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
  });

  describe("claude command routing", () => {
    it("recognizes an answer-researcher stdin prompt", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "You are the answer-researcher agent" }),
      );
      expect(extractStage(result.stdout)).toBe("answer-researcher");
    });

    it("recognizes an 'open questions to research' stdin prompt", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Here are the open questions to research" }),
      );
      expect(extractStage(result.stdout)).toBe("answer-researcher");
    });

    it("recognizes a plan-reviser stdin prompt", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "You are performing plan revision" }),
      );
      expect(extractStage(result.stdout)).toBe("plan-reviser");
    });

    it("recognizes a 'lead engineer' stdin prompt as plan-reviser", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "You are a lead engineer reviewing changes" }),
      );
      expect(extractStage(result.stdout)).toBe("plan-reviser");
    });

    it("recognizes a planner stdin prompt", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Produce an implementation plan" }),
      );
      expect(extractStage(result.stdout)).toBe("planner");
    });

    it("recognizes a remediation stdin prompt", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Please remediate the review findings" }),
      );
      expect(extractStage(result.stdout)).toBe("remediation");
    });

    it("defaults to the executor output for an unrecognized claude prompt", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "just implement it" }),
      );
      expect(extractStage(result.stdout)).toBe("executor");
    });

    it("matches when the command merely ends with 'claude' (e.g. an absolute path)", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/claude", stdinData: "implementation plan" }),
      );
      expect(extractStage(result.stdout)).toBe("planner");
    });

    it("is case-insensitive when matching stdin content", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "ANSWER-RESEARCHER task" }),
      );
      expect(extractStage(result.stdout)).toBe("answer-researcher");
    });
  });

  describe("codex command routing", () => {
    it("recognizes a plan review stdin prompt", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "Perform a plan review" }),
      );
      expect(extractStage(result.stdout)).toBe("plan-reviewer");
    });

    it("recognizes a 'plan under review' stdin prompt", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "The plan under review is attached" }),
      );
      expect(extractStage(result.stdout)).toBe("plan-reviewer");
    });

    it("returns a changes_requested code review on the first call and approved on the second", async () => {
      const handler = createMockProcessHandler();

      const first = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
      const second = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));

      const firstPayload = JSON.parse(
        first.stdout.slice(
          first.stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length,
          first.stdout.indexOf(STRUCTURED_OUTPUT_END),
        ),
      ) as { payload: { overallVerdict: string } };
      const secondPayload = JSON.parse(
        second.stdout.slice(
          second.stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length,
          second.stdout.indexOf(STRUCTURED_OUTPUT_END),
        ),
      ) as { payload: { overallVerdict: string } };

      expect(extractStage(first.stdout)).toBe("reviewer");
      expect(firstPayload.payload.overallVerdict).toBe("changes_requested");
      expect(extractStage(second.stdout)).toBe("reviewer");
      expect(secondPayload.payload.overallVerdict).toBe("approved");
    });

    it("keeps plan-review and code-review call counters independent", async () => {
      const handler = createMockProcessHandler();

      // A plan review call should not consume the code-review counter.
      await handler(baseOptions({ command: "codex", stdinData: "plan review please" }));
      const codeReview = await handler(baseOptions({ command: "codex", stdinData: "review diff" }));

      const payload = JSON.parse(
        codeReview.stdout.slice(
          codeReview.stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length,
          codeReview.stdout.indexOf(STRUCTURED_OUTPUT_END),
        ),
      ) as { payload: { overallVerdict: string } };
      // First actual code-review call, so still changes_requested.
      expect(payload.payload.overallVerdict).toBe("changes_requested");
    });

    it("matches when the command merely ends with 'codex'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/codex", stdinData: "plan review" }),
      );
      expect(extractStage(result.stdout)).toBe("plan-reviewer");
    });
  });

  describe("unrecognized command", () => {
    it("returns a failure envelope with stage 'planner' and success:false", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "cursor", stdinData: "anything" }));

      const begin = result.stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
      const end = result.stdout.indexOf(STRUCTURED_OUTPUT_END);
      const payload = JSON.parse(result.stdout.slice(begin, end).trim()) as {
        success: boolean;
        stage: string;
      };

      expect(payload.success).toBe(false);
      expect(payload.stage).toBe("planner");
    });
  });

  it("handles a missing stdinData (defaults to empty string) without throwing", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "claude", stdinData: undefined }));
    expect(extractStage(result.stdout)).toBe("executor");
  });
});
