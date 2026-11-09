import { describe, it, expect, vi } from "vitest";
import { PlanReviewerAgent } from "../../src/agents/planReviewerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";

// Covers the operatorNote branch of PlanReviewerAgent.run() that
// planReviewerAgent.test.ts (relatedContext rendering) does not exercise.

function makeTaskBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "Test issue", description: "Test description", labels: [], priority: 0 },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp",
      allowedPaths: ["src/"],
      protectedPaths: [],
    },
    constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    definitionOfDone: [],
  };
}

function makePlan(): Plan {
  return {
    planVersion: 1,
    summary: "Test plan",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
  };
}

function buildAgent() {
  let capturedUserPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedUserPrompt = opts.prompt;
      return {
        raw: "raw",
        parsed: {
          payload: { reviewId: "plan-rev-001", summary: "ok", findings: [], overallVerdict: "approved" as const },
        },
      };
    }),
  };

  const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const agent = new PlanReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, logger, getUserPrompt: () => capturedUserPrompt };
}

describe("PlanReviewerAgent.run() operator note branch", () => {
  it("injects the Operator Note section into the user prompt when provided", async () => {
    const { agent, getUserPrompt, logger } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", {
      operatorNote: "Focus on the auth changes.",
    });

    const userPrompt = getUserPrompt();
    expect(userPrompt).toContain("## Operator Note");
    expect(userPrompt).toContain("Focus on the auth changes.");

    const startLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Starting plan reviewer agent (Codex CLI)",
    );
    expect((startLog?.[0] as Record<string, unknown>).hasOperatorNote).toBe(true);
  });

  it("omits the Operator Note section when not provided", async () => {
    const { agent, getUserPrompt } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    expect(getUserPrompt()).not.toContain("## Operator Note");
  });
});
