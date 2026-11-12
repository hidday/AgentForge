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

  return { agent, logger, getPrompt: () => capturedPrompt };
}

describe("PlanReviewerAgent.run() operator note handling", () => {
  it("renders the '## Operator Note' section with the note text when operatorNote is provided", async () => {
    const { agent, getPrompt } = buildPlanReviewerAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", {
      operatorNote: "Double-check the migration rollback plan.",
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Operator Note");
    expect(prompt).toContain("Double-check the migration rollback plan.");
    expect(prompt).toContain("prefer `changes_requested`");
  });

  it("logs hasOperatorNote=true in the start log when an operator note is provided", async () => {
    const { agent, logger } = buildPlanReviewerAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", { operatorNote: "Note" });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ hasOperatorNote: true }),
      "Starting plan reviewer agent (Codex CLI)",
    );
  });

  it("omits the '## Operator Note' section and logs hasOperatorNote=false when no options are given", async () => {
    const { agent, logger, getPrompt } = buildPlanReviewerAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    expect(getPrompt()).not.toContain("## Operator Note");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ hasOperatorNote: false }),
      "Starting plan reviewer agent (Codex CLI)",
    );
  });
});
