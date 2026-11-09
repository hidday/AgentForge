import { describe, it, expect, vi } from "vitest";
import { PlanReviserAgent } from "../../src/agents/planReviserAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";

// Covers the operatorNote branch of PlanReviserAgent.run() that
// planReviserAgent.test.ts (relatedContext rendering) does not exercise.

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

function makePlanReview(): PlanReview {
  return { reviewId: "plan-rev-001", summary: "Looks fine", findings: [], overallVerdict: "approved" };
}

function buildAgent() {
  let capturedUserPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedUserPrompt = opts.prompt;
      return {
        raw: "raw",
        parsed: {
          payload: {
            revision: {
              originalPlanVersion: 1,
              revisedPlanVersion: 2,
              reviewId: "plan-rev-001",
              dispositions: [],
            },
            revisedPlan: { ...makePlan(), planVersion: 2 },
          },
        },
      };
    }),
  };

  const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const agent = new PlanReviserAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, logger, getUserPrompt: () => capturedUserPrompt };
}

describe("PlanReviserAgent.run() operator note branch", () => {
  it("injects the Operator Note section into the user prompt when provided", async () => {
    const { agent, getUserPrompt, logger } = buildAgent();

    await agent.run(makePlan(), makePlanReview(), makeTaskBundle(), "run-1", {
      operatorNote: "Keep the migration step.",
    });

    const userPrompt = getUserPrompt();
    expect(userPrompt).toContain("## Operator Note");
    expect(userPrompt).toContain("Keep the migration step.");

    const startLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Starting plan reviser agent (Claude CLI, boss mode)",
    );
    expect((startLog?.[0] as Record<string, unknown>).hasOperatorNote).toBe(true);
  });

  it("omits the Operator Note section when not provided", async () => {
    const { agent, getUserPrompt } = buildAgent();

    await agent.run(makePlan(), makePlanReview(), makeTaskBundle(), "run-1");

    expect(getUserPrompt()).not.toContain("## Operator Note");
  });
});
