import { describe, it, expect, beforeEach } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function baseOptions(overrides: Partial<ProcessSpawnOptions>): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/workspace",
    timeoutMs: 120_000,
    ...overrides,
  };
}

/** Extracts and parses the JSON payload wrapped between the structured-output markers. */
function extractPayload(stdout: string): unknown {
  const begin = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN);
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  expect(begin).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(begin);
  const jsonText = stdout.slice(begin + STRUCTURED_OUTPUT_BEGIN.length, end).trim();
  return JSON.parse(jsonText);
}

describe("createMockProcessHandler", () => {
  let handler: ReturnType<typeof createMockProcessHandler>;

  beforeEach(() => {
    handler = createMockProcessHandler();
  });

  it("returns a well-formed ProcessResult envelope regardless of branch", async () => {
    const result = await handler(baseOptions({ command: "claude", stdinData: "" }));

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
  });

  describe("claude command routing", () => {
    it("routes 'answer-researcher' stdin content to the answer-researcher output", async () => {
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "You are the answer-researcher agent." }),
      );
      const payload = extractPayload(result.stdout) as { stage: string; payload: unknown };
      expect(payload.stage).toBe("answer-researcher");
      expect(
        (payload.payload as { answers: unknown[] }).answers,
      ).toBeInstanceOf(Array);
    });

    it("routes 'open questions to research' stdin content to the answer-researcher output", async () => {
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Here are the open questions to research:" }),
      );
      const payload = extractPayload(result.stdout) as { stage: string };
      expect(payload.stage).toBe("answer-researcher");
    });

    it("routes 'plan revision' stdin content to the plan-reviser output", async () => {
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Please perform a plan revision now." }),
      );
      const payload = extractPayload(result.stdout) as {
        stage: string;
        payload: { revision: { revisedPlanVersion: number }; revisedPlan: { planVersion: number } };
      };
      expect(payload.stage).toBe("plan-reviser");
      expect(payload.payload.revision.revisedPlanVersion).toBe(2);
      expect(payload.payload.revisedPlan.planVersion).toBe(2);
    });

    it("routes 'plan-reviser' stdin content to the plan-reviser output", async () => {
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "role: plan-reviser" }),
      );
      const payload = extractPayload(result.stdout) as { stage: string };
      expect(payload.stage).toBe("plan-reviser");
    });

    it("routes 'lead engineer' stdin content to the plan-reviser output", async () => {
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "You are the lead engineer revising the plan." }),
      );
      const payload = extractPayload(result.stdout) as { stage: string };
      expect(payload.stage).toBe("plan-reviser");
    });

    it("routes 'planner' stdin content to the planner output", async () => {
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "You are the planner for this issue." }),
      );
      const payload = extractPayload(result.stdout) as {
        stage: string;
        payload: { planVersion: number; steps: unknown[] };
      };
      expect(payload.stage).toBe("planner");
      expect(payload.payload.planVersion).toBe(1);
      expect(payload.payload.steps.length).toBeGreaterThan(0);
    });

    it("routes 'implementation plan' stdin content to the planner output", async () => {
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Produce an implementation plan for this." }),
      );
      const payload = extractPayload(result.stdout) as { stage: string };
      expect(payload.stage).toBe("planner");
    });

    it("routes 'remediat' stdin content (substring of remediation/remediate) to the remediation output", async () => {
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Begin remediation of the review findings." }),
      );
      const payload = extractPayload(result.stdout) as {
        stage: string;
        payload: { readyForHumanReview: boolean; resolution: unknown[] };
      };
      expect(payload.stage).toBe("remediation");
      expect(payload.payload.readyForHumanReview).toBe(true);
      expect(payload.payload.resolution.length).toBeGreaterThan(0);
    });

    it("falls back to the executor output when stdin matches none of the known keywords", async () => {
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Just implement the feature please." }),
      );
      const payload = extractPayload(result.stdout) as {
        stage: string;
        payload: { filesChanged: unknown[]; score: number };
      };
      expect(payload.stage).toBe("executor");
      expect(payload.payload.filesChanged.length).toBeGreaterThan(0);
      expect(payload.payload.score).toBe(0.78);
    });

    it("falls back to the executor output when stdinData is undefined", async () => {
      const result = await handler(baseOptions({ command: "claude", stdinData: undefined }));
      const payload = extractPayload(result.stdout) as { stage: string };
      expect(payload.stage).toBe("executor");
    });

    it("matches a claude command given as an absolute path ending in 'claude'", async () => {
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/claude", stdinData: "planner" }),
      );
      const payload = extractPayload(result.stdout) as { stage: string };
      expect(payload.stage).toBe("planner");
    });

    it("is case-insensitive when matching stdin keywords", async () => {
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "ROLE: PLANNER TASK" }),
      );
      const payload = extractPayload(result.stdout) as { stage: string };
      expect(payload.stage).toBe("planner");
    });
  });

  describe("codex command routing", () => {
    it("routes 'plan review' stdin content to the plan-reviewer output", async () => {
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "Conduct a plan review of the attached plan." }),
      );
      const payload = extractPayload(result.stdout) as {
        stage: string;
        payload: { overallVerdict: string; findings: unknown[] };
      };
      expect(payload.stage).toBe("plan-reviewer");
      expect(payload.payload.overallVerdict).toBe("changes_requested");
      expect(payload.payload.findings.length).toBeGreaterThan(0);
    });

    it("routes 'plan-reviewer' stdin content to the plan-reviewer output", async () => {
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "role: plan-reviewer" }),
      );
      const payload = extractPayload(result.stdout) as { stage: string };
      expect(payload.stage).toBe("plan-reviewer");
    });

    it("routes 'plan under review' stdin content to the plan-reviewer output", async () => {
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "The plan under review is attached below." }),
      );
      const payload = extractPayload(result.stdout) as { stage: string };
      expect(payload.stage).toBe("plan-reviewer");
    });

    it("alternates code review verdicts: first call changes_requested, second call approved", async () => {
      const first = await handler(
        baseOptions({ command: "codex", stdinData: "Please review this diff for correctness." }),
      );
      const firstPayload = extractPayload(first.stdout) as {
        stage: string;
        payload: { overallVerdict: string; reviewId: string };
      };
      expect(firstPayload.stage).toBe("reviewer");
      expect(firstPayload.payload.overallVerdict).toBe("changes_requested");
      expect(firstPayload.payload.reviewId).toBe("rev-001");

      const second = await handler(
        baseOptions({ command: "codex", stdinData: "Please review this diff for correctness." }),
      );
      const secondPayload = extractPayload(second.stdout) as {
        stage: string;
        payload: { overallVerdict: string; reviewId: string };
      };
      expect(secondPayload.stage).toBe("reviewer");
      expect(secondPayload.payload.overallVerdict).toBe("approved");
      expect(secondPayload.payload.reviewId).toBe("rev-002");
    });

    it("keeps returning 'approved' for code review calls after the second one", async () => {
      await handler(baseOptions({ command: "codex", stdinData: "review the diff" }));
      await handler(baseOptions({ command: "codex", stdinData: "review the diff" }));
      const third = await handler(baseOptions({ command: "codex", stdinData: "review the diff" }));

      const payload = extractPayload(third.stdout) as { payload: { overallVerdict: string } };
      expect(payload.payload.overallVerdict).toBe("approved");
    });

    it("tracks the code-review call count independently per handler instance", async () => {
      const otherHandler = createMockProcessHandler();
      const result = await otherHandler(
        baseOptions({ command: "codex", stdinData: "review the diff" }),
      );
      const payload = extractPayload(result.stdout) as { payload: { overallVerdict: string } };
      // A fresh handler's call-count map starts over, so this is call #1 again.
      expect(payload.payload.overallVerdict).toBe("changes_requested");
    });

    it("matches a codex command given as an absolute path ending in 'codex'", async () => {
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/codex", stdinData: "plan review" }),
      );
      const payload = extractPayload(result.stdout) as { stage: string };
      expect(payload.stage).toBe("plan-reviewer");
    });
  });

  describe("unknown command fallback", () => {
    it("returns a failure envelope for a command that is neither claude nor codex", async () => {
      const result = await handler(baseOptions({ command: "cursor-agent", stdinData: "anything" }));
      const payload = extractPayload(result.stdout) as {
        success: boolean;
        stage: string;
        payload: Record<string, unknown>;
      };
      expect(payload.success).toBe(false);
      expect(payload.stage).toBe("planner");
      expect(payload.payload).toEqual({});
    });

    it("still returns exitCode 0 and timedOut false for the unknown-command fallback", async () => {
      const result = await handler(baseOptions({ command: "unknown-tool" }));
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
    });
  });
});
