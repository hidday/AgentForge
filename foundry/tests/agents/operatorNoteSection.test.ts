import { describe, it, expect, vi } from "vitest";
import { ExecutorAgent } from "../../src/agents/executorAgent.js";
import { PlanReviewerAgent } from "../../src/agents/planReviewerAgent.js";
import { PlanReviserAgent } from "../../src/agents/planReviserAgent.js";
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
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
  };
}

function noopLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("operatorNoteSection rendering", () => {
  it("ExecutorAgent injects the Operator Note section into the prompt when operatorNote is provided", async () => {
    let capturedPrompt = "";
    const agentRunner = {
      run: vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
        capturedPrompt = opts.prompt;
        return {
          raw: "raw",
          parsed: {
            payload: {
              executionVersion: 1,
              summary: "s",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.5,
              scoreRationale: "r",
            },
          },
        };
      }),
    };
    const artifactRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn(), findLatestByType: vi.fn() };
    const githubClient = { createDraftPR: vi.fn().mockResolvedValue(1), getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };
    const gitService = { commitAndPush: vi.fn().mockResolvedValue(undefined) };

    const agent = new ExecutorAgent(
      agentRunner as never,
      artifactRepo as never,
      githubClient as never,
      gitService as never,
      noopLogger() as never,
    );

    await agent.run(makePlan(), makeTaskBundle(), "run-1", undefined, {
      operatorNote: "Please use feature flags for rollout.",
    });

    expect(capturedPrompt).toContain("## Operator Note");
    expect(capturedPrompt).toContain("Please use feature flags for rollout.");
  });

  it("ExecutorAgent omits the Operator Note section when no operatorNote is given", async () => {
    let capturedPrompt = "";
    const agentRunner = {
      run: vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
        capturedPrompt = opts.prompt;
        return {
          raw: "raw",
          parsed: {
            payload: {
              executionVersion: 1,
              summary: "s",
              filesChanged: [],
              checks: {
                lint: { status: "pass", details: "" },
                typecheck: { status: "pass", details: "" },
                tests: { status: "pass", details: "" },
              },
              notes: [],
              prDraftCreated: false,
              score: 0.5,
              scoreRationale: "r",
            },
          },
        };
      }),
    };
    const artifactRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn(), findLatestByType: vi.fn() };
    const githubClient = { createDraftPR: vi.fn().mockResolvedValue(1), getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };
    const gitService = { commitAndPush: vi.fn().mockResolvedValue(undefined) };

    const agent = new ExecutorAgent(
      agentRunner as never,
      artifactRepo as never,
      githubClient as never,
      gitService as never,
      noopLogger() as never,
    );

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    expect(capturedPrompt).not.toContain("## Operator Note");
  });

  it("PlanReviewerAgent injects the Operator Note section when operatorNote is provided", async () => {
    let capturedPrompt = "";
    const agentRunner = {
      run: vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
        capturedPrompt = opts.prompt;
        return {
          raw: "raw",
          parsed: { payload: { reviewId: "r1", summary: "ok", findings: [], overallVerdict: "approved" as const } },
        };
      }),
    };
    const artifactRepo = { create: vi.fn().mockResolvedValue({}) };

    const agent = new PlanReviewerAgent(agentRunner as never, artifactRepo as never, noopLogger() as never);

    await agent.run(makePlan(), makeTaskBundle(), "run-1", {
      operatorNote: "Double-check backward compatibility.",
    });

    expect(capturedPrompt).toContain("## Operator Note");
    expect(capturedPrompt).toContain("Double-check backward compatibility.");
    expect(capturedPrompt).toContain("prefer `changes_requested`");
  });

  it("PlanReviewerAgent omits the Operator Note section when no operatorNote is given", async () => {
    let capturedPrompt = "";
    const agentRunner = {
      run: vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
        capturedPrompt = opts.prompt;
        return {
          raw: "raw",
          parsed: { payload: { reviewId: "r1", summary: "ok", findings: [], overallVerdict: "approved" as const } },
        };
      }),
    };
    const artifactRepo = { create: vi.fn().mockResolvedValue({}) };

    const agent = new PlanReviewerAgent(agentRunner as never, artifactRepo as never, noopLogger() as never);

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    expect(capturedPrompt).not.toContain("## Operator Note");
  });

  it("PlanReviserAgent injects the Operator Note section when operatorNote is provided", async () => {
    let capturedPrompt = "";
    const agentRunner = {
      run: vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
        capturedPrompt = opts.prompt;
        return {
          raw: "raw",
          parsed: {
            payload: {
              revision: {
                originalPlanVersion: 1,
                revisedPlanVersion: 2,
                dispositions: [],
              },
              revisedPlan: makePlan(),
            },
          },
        };
      }),
    };
    const artifactRepo = { create: vi.fn().mockResolvedValue({}) };
    const planReview = { reviewId: "r1", summary: "ok", findings: [], overallVerdict: "changes_requested" as const };

    const agent = new PlanReviserAgent(agentRunner as never, artifactRepo as never, noopLogger() as never);

    await agent.run(makePlan(), planReview, makeTaskBundle(), "run-1", {
      operatorNote: "Keep the rate limiter untouched.",
    });

    expect(capturedPrompt).toContain("## Operator Note");
    expect(capturedPrompt).toContain("Keep the rate limiter untouched.");
    expect(capturedPrompt).toContain("do not drop the findings in favor of the note");
  });

  it("PlanReviserAgent omits the Operator Note section when no operatorNote is given", async () => {
    let capturedPrompt = "";
    const agentRunner = {
      run: vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
        capturedPrompt = opts.prompt;
        return {
          raw: "raw",
          parsed: {
            payload: {
              revision: { originalPlanVersion: 1, revisedPlanVersion: 2, dispositions: [] },
              revisedPlan: makePlan(),
            },
          },
        };
      }),
    };
    const artifactRepo = { create: vi.fn().mockResolvedValue({}) };
    const planReview = { reviewId: "r1", summary: "ok", findings: [], overallVerdict: "changes_requested" as const };

    const agent = new PlanReviserAgent(agentRunner as never, artifactRepo as never, noopLogger() as never);

    await agent.run(makePlan(), planReview, makeTaskBundle(), "run-1");

    expect(capturedPrompt).not.toContain("## Operator Note");
  });
});
