import { describe, it, expect, vi } from "vitest";
import { ReviewerAgent } from "../../src/agents/reviewerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

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

function makeExecutionReport(): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "" },
      typecheck: { status: "pass", details: "" },
      tests: { status: "pass", details: "" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.85,
    scoreRationale: "solid",
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
    summary: "Looks good overall",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function buildReviewerAgent(review: Review) {
  let capturedPrompt = "";
  let capturedRuntime: unknown;

  const agentRunner = {
    run: vi.fn().mockImplementation(async (runtime: unknown, opts: { prompt: string }) => {
      capturedRuntime = runtime;
      capturedPrompt = opts.prompt;
      return {
        raw: "raw cli output",
        parsed: { payload: review },
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

  const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

  return {
    agent,
    artifactRepo,
    logger,
    getPrompt: () => capturedPrompt,
    getRuntime: () => capturedRuntime,
  };
}

describe("ReviewerAgent.run", () => {
  it("renders prompts, persists the transcript and review artifacts, and returns the review", async () => {
    const review = makeReview();
    const { agent, artifactRepo, getPrompt, getRuntime } = buildReviewerAgent(review);

    const result = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff --git a/src/a.ts b/src/a.ts",
      makeTaskBundle(),
      "run-1",
    );

    expect(result).toEqual(review);
    expect(getRuntime()).toBe("codex");
    expect(getPrompt()).toContain("diff --git");

    expect(artifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        type: "ReviewerTranscript",
        version: 3,
        rawText: "raw cli output",
      }),
    );
    expect(artifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        type: "Review",
        version: 1,
        payloadJson: review,
      }),
    );
  });

  it("logs blocker and important finding counts", async () => {
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t1", details: "d1" },
        { id: "f2", severity: "blocker", type: "bug", file: "a.ts", title: "t2", details: "d2" },
        { id: "f3", severity: "important", type: "bug", file: "a.ts", title: "t3", details: "d3" },
        { id: "f4", severity: "nit", type: "style", file: "a.ts", title: "t4", details: "d4" },
      ],
    });
    const { agent, logger } = buildReviewerAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ blockerCount: 2, importantCount: 1, totalFindings: 4 }),
      "Review completed",
    );
  });
});
