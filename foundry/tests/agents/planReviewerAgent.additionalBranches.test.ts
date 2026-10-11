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

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const agent = new PlanReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, logger, getPrompt: () => capturedPrompt };
}

describe("PlanReviewerAgent.run() operator note branch", () => {
  it("injects the Operator Note section into the user prompt when operatorNote is provided", async () => {
    const { agent, getPrompt } = buildPlanReviewerAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", {
      operatorNote: "Make sure the migration risk is called out.",
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Operator Note");
    expect(prompt).toContain("prefer `changes_requested`");
    expect(prompt).toContain("Make sure the migration risk is called out.");
  });

  it("logs hasOperatorNote: true when an operator note is present", async () => {
    const { agent, logger } = buildPlanReviewerAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", {
      operatorNote: "Looks fine to me.",
    });

    const startLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Starting plan reviewer agent (Codex CLI)",
    );
    expect(startLog).toBeDefined();
    expect((startLog?.[0] as Record<string, unknown>).hasOperatorNote).toBe(true);
  });

  it("omits the Operator Note section and logs hasOperatorNote: false when no note is given", async () => {
    const { agent, logger, getPrompt } = buildPlanReviewerAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    expect(getPrompt()).not.toContain("## Operator Note");

    const startLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Starting plan reviewer agent (Codex CLI)",
    );
    expect((startLog?.[0] as Record<string, unknown>).hasOperatorNote).toBe(false);
  });
});
