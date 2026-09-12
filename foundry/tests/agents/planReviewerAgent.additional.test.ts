import { describe, it, expect, vi } from "vitest";
import { PlanReviewerAgent } from "../../src/agents/planReviewerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";

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
    requirementsTraceability: "Traceability",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
  };
}

function buildPlanReviewerAgent() {
  let capturedPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return {
        raw: "raw text",
        parsed: {
          payload: {
            reviewId: "plan-rev-001",
            summary: "Looks ok",
            findings: [],
            overallVerdict: "approved" as const,
          },
        },
      };
    }),
  };

  const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const agent = new PlanReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);
  return { agent, getPrompt: () => capturedPrompt };
}

describe("PlanReviewerAgent.run() operator note section", () => {
  it("renders the Operator Note section when an operatorNote is provided", async () => {
    const { agent, getPrompt } = buildPlanReviewerAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", {
      operatorNote: "Focus on security implications.",
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Operator Note");
    expect(prompt).toContain("Focus on security implications.");
    expect(prompt).toContain("changes_requested");
  });

  it("omits the Operator Note section when no operatorNote is provided", async () => {
    const { agent, getPrompt } = buildPlanReviewerAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Operator Note");
    expect(prompt).not.toContain("{{operatorNoteSection}}");
  });
});
