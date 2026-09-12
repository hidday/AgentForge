import { describe, it, expect, vi } from "vitest";
import { PlanReviserAgent } from "../../src/agents/planReviserAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";

function makeTaskBundle(): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      labels: [],
      priority: 0,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp",
      allowedPaths: ["src/"],
      protectedPaths: [],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
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
  return {
    reviewId: "plan-rev-001",
    summary: "Needs work",
    findings: [
      {
        id: "pf1",
        severity: "important",
        type: "missing_requirement",
        title: "Missing error handling",
        details: "Handle the edge case",
      },
    ],
    overallVerdict: "changes_requested",
  };
}

function buildAgent() {
  let capturedPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return {
        raw: "raw text",
        parsed: {
          payload: {
            revision: {
              originalPlanVersion: 1,
              revisedPlanVersion: 2,
              reviewId: "plan-rev-001",
              dispositions: [
                { findingId: "pf1", status: "accepted", rationale: "Good catch" },
              ],
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
  return { agent, getPrompt: () => capturedPrompt };
}

describe("PlanReviserAgent.run() operator note section", () => {
  it("renders the Operator Note section when an operatorNote is provided", async () => {
    const { agent, getPrompt } = buildAgent();

    await agent.run(makePlan(), makePlanReview(), makeTaskBundle(), "run-1", {
      operatorNote: "Don't drop the auth requirement.",
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Operator Note");
    expect(prompt).toContain("Don't drop the auth requirement.");
    expect(prompt).toContain("do not drop the findings");
  });

  it("omits the Operator Note section when no operatorNote is provided", async () => {
    const { agent, getPrompt } = buildAgent();

    await agent.run(makePlan(), makePlanReview(), makeTaskBundle(), "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Operator Note");
    expect(prompt).not.toContain("{{operatorNoteSection}}");
  });
});
