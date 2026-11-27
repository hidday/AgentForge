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
    requirementsTraceability: "",
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
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Good",
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
    summary: "Reviewed",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function buildAgent(review: Review) {
  let capturedArgs: { runtime: unknown; input: { prompt: string }; stage: unknown } | undefined;

  const agentRunner = {
    run: vi.fn().mockImplementation(async (runtime: unknown, input: { prompt: string }, stage: unknown) => {
      capturedArgs = { runtime, input, stage };
      return {
        raw: "raw transcript text",
        parsed: { payload: review },
        success: true,
        stage: "reviewer",
        durationMs: 10,
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

  return { agent, agentRunner, artifactRepo, logger, getCapturedArgs: () => capturedArgs };
}

describe("ReviewerAgent.run", () => {
  it("routes to the codex runtime for the reviewer stage with the rendered prompt", async () => {
    const review = makeReview();
    const { agent, getCapturedArgs } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/a.ts b/a.ts", makeTaskBundle(), "run-1");

    const args = getCapturedArgs();
    expect(args?.runtime).toBe("codex");
    expect(args?.stage).toBe("reviewer");
    expect(args?.input.prompt).toContain("diff --git a/a.ts b/a.ts");
    expect(args?.input.prompt).toContain("Implemented the feature");
  });

  it("persists a ReviewerTranscript artifact with the raw output", async () => {
    const review = makeReview();
    const { agent, artifactRepo } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(artifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        type: "ReviewerTranscript",
        version: 3,
        rawText: "raw transcript text",
      }),
    );
  });

  it("persists a Review artifact with the parsed payload and returns it", async () => {
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "Bug", details: "d" },
      ],
    });
    const { agent, artifactRepo } = buildAgent(review);

    const result = await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(artifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        type: "Review",
        version: 1,
        payloadJson: review,
        rawText: JSON.stringify(review, null, 2),
      }),
    );
    expect(result).toEqual(review);
  });

  it("logs blocker and important finding counts separately from other severities", async () => {
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "B1", details: "d" },
        { id: "f2", severity: "blocker", type: "bug", file: "b.ts", title: "B2", details: "d" },
        { id: "f3", severity: "important", type: "bug", file: "c.ts", title: "I1", details: "d" },
        { id: "f4", severity: "nit", type: "style", file: "d.ts", title: "N1", details: "d" },
      ],
    });
    const { agent, logger } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        reviewId: "rev-001",
        verdict: "changes_requested",
        totalFindings: 4,
        blockerCount: 2,
        importantCount: 1,
      }),
      "Review completed",
    );
  });

  it("handles a review with zero findings without error", async () => {
    const review = makeReview({ findings: [] });
    const { agent, logger } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalFindings: 0, blockerCount: 0, importantCount: 0 }),
      "Review completed",
    );
  });
});
