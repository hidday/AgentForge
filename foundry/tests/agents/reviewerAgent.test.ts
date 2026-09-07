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
    summary: "Did the work",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "" },
      typecheck: { status: "pass", details: "" },
      tests: { status: "pass", details: "" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "clean",
  };
}

function buildReviewerAgent(reviewOverrides: Partial<Review> = {}) {
  let capturedPrompt = "";
  let capturedSystemPrompt = "";
  let capturedRuntime: unknown;
  let capturedStage: unknown;

  const review: Review = {
    reviewId: "review-001",
    summary: "Looks good overall",
    findings: [
      { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t1", details: "d1" },
      { id: "f2", severity: "important", type: "perf", file: "b.ts", title: "t2", details: "d2" },
      { id: "f3", severity: "nit", type: "style", file: "c.ts", title: "t3", details: "d3" },
    ],
    overallVerdict: "changes_requested",
    ...reviewOverrides,
  };

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (runtime: unknown, opts: { prompt: string; systemPrompt?: string }, stage: unknown) => {
        capturedPrompt = opts.prompt;
        capturedSystemPrompt = opts.systemPrompt ?? "";
        capturedRuntime = runtime;
        capturedStage = stage;
        return {
          raw: "raw transcript text",
          parsed: { payload: review },
        };
      },
    ),
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
    agentRunner,
    review,
    getPrompt: () => capturedPrompt,
    getSystemPrompt: () => capturedSystemPrompt,
    getRuntime: () => capturedRuntime,
    getStage: () => capturedStage,
  };
}

describe("ReviewerAgent.run", () => {
  it("routes to the codex runtime on the 'reviewer' stage", async () => {
    const { agent, getRuntime, getStage } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff text", makeTaskBundle(), "run-1");

    expect(getRuntime()).toBe("codex");
    expect(getStage()).toBe("reviewer");
  });

  it("renders the diff and execution report into the prompts", async () => {
    const { agent, getPrompt } = buildReviewerAgent();

    await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff --git a/foo.ts b/foo.ts\n+added line",
      makeTaskBundle(),
      "run-1",
    );

    const prompt = getPrompt();
    expect(prompt).toContain("added line");
  });

  it("persists a ReviewerTranscript artifact with the raw output", async () => {
    const { agent, artifactRepo } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const transcriptCall = artifactRepo.create.mock.calls.find(
      (call: unknown[]) => (call[0] as { type: string }).type === "ReviewerTranscript",
    );
    expect(transcriptCall).toBeDefined();
    expect((transcriptCall![0] as { runId: string; rawText: string }).runId).toBe("run-1");
    expect((transcriptCall![0] as { rawText: string }).rawText).toBe("raw transcript text");
  });

  it("persists a Review artifact with the parsed review payload as JSON", async () => {
    const { agent, artifactRepo, review } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const reviewCall = artifactRepo.create.mock.calls.find(
      (call: unknown[]) => (call[0] as { type: string }).type === "Review",
    );
    expect(reviewCall).toBeDefined();
    expect((reviewCall![0] as { payloadJson: Review }).payloadJson).toEqual(review);
    expect((reviewCall![0] as { rawText: string }).rawText).toBe(JSON.stringify(review, null, 2));
  });

  it("returns the parsed review from output.parsed.payload", async () => {
    const { agent, review } = buildReviewerAgent();

    const result = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff",
      makeTaskBundle(),
      "run-1",
    );

    expect(result).toEqual(review);
  });

  it("logs blocker and important finding counts computed from severities", async () => {
    const { agent, logger } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completedCall = logger.info.mock.calls.find(
      (call: unknown[]) => call[1] === "Review completed",
    );
    expect(completedCall).toBeDefined();
    expect(completedCall![0]).toMatchObject({
      runId: "run-1",
      reviewId: "review-001",
      verdict: "changes_requested",
      totalFindings: 3,
      blockerCount: 1,
      importantCount: 1,
    });
  });

  it("logs zero blocker/important counts when the review has an empty findings list", async () => {
    const { agent, logger } = buildReviewerAgent({ findings: [], overallVerdict: "approved" });

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completedCall = logger.info.mock.calls.find(
      (call: unknown[]) => call[1] === "Review completed",
    );
    expect(completedCall![0]).toMatchObject({
      totalFindings: 0,
      blockerCount: 0,
      importantCount: 0,
      verdict: "approved",
    });
  });
});
