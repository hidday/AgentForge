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

function buildPlanReviserAgent() {
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
            revisedPlan: {
              ...makePlan(),
              planVersion: 2,
            },
          },
        },
      };
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const agent = new PlanReviserAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, logger, getPrompt: () => capturedPrompt };
}

describe("PlanReviserAgent.run() operator note branch", () => {
  it("injects the Operator Note section into the user prompt when operatorNote is provided", async () => {
    const { agent, getPrompt } = buildPlanReviserAgent();

    await agent.run(makePlan(), makePlanReview(), makeTaskBundle(), "run-1", {
      operatorNote: "Prioritize the security finding.",
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Operator Note");
    expect(prompt).toContain("do not drop the findings in favor of the note");
    expect(prompt).toContain("Prioritize the security finding.");
  });

  it("logs hasOperatorNote: true when an operator note is present", async () => {
    const { agent, logger } = buildPlanReviserAgent();

    await agent.run(makePlan(), makePlanReview(), makeTaskBundle(), "run-1", {
      operatorNote: "Go ahead.",
    });

    const startLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Starting plan reviser agent (Claude CLI, boss mode)",
    );
    expect(startLog).toBeDefined();
    expect((startLog?.[0] as Record<string, unknown>).hasOperatorNote).toBe(true);
  });

  it("omits the Operator Note section and logs hasOperatorNote: false when no note is given", async () => {
    const { agent, logger, getPrompt } = buildPlanReviserAgent();

    await agent.run(makePlan(), makePlanReview(), makeTaskBundle(), "run-1");

    expect(getPrompt()).not.toContain("## Operator Note");

    const startLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Starting plan reviser agent (Claude CLI, boss mode)",
    );
    expect((startLog?.[0] as Record<string, unknown>).hasOperatorNote).toBe(false);
  });
});
