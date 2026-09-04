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
    requirementsTraceability: "Traceability",
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
    summary: "Looks fine",
    findings: [],
    overallVerdict: "approved",
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

  return { agent, logger, getPrompt: () => capturedPrompt };
}

describe("PlanReviserAgent.run() operator note handling", () => {
  it("injects the Operator Note section into the user prompt when operatorNote is provided", async () => {
    const { agent, getPrompt } = buildAgent();

    await agent.run(makePlan(), makePlanReview(), makeTaskBundle(), "run-1", {
      operatorNote: "Keep the migration backward-compatible.",
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Operator Note");
    expect(prompt).toContain("Keep the migration backward-compatible.");
    expect(prompt).not.toContain("{{operatorNoteSection}}");
  });

  it("omits the Operator Note section when no operatorNote is given", async () => {
    const { agent, getPrompt } = buildAgent();

    await agent.run(makePlan(), makePlanReview(), makeTaskBundle(), "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Operator Note");
  });

  it("logs hasOperatorNote:true when an operator note is provided", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makePlanReview(), makeTaskBundle(), "run-1", {
      operatorNote: "Note text",
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ hasOperatorNote: true }),
      "Starting plan reviser agent (Claude CLI, boss mode)",
    );
  });

  it("logs hasOperatorNote:false when no options are passed", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makePlanReview(), makeTaskBundle(), "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ hasOperatorNote: false }),
      "Starting plan reviser agent (Claude CLI, boss mode)",
    );
  });
});
