import { describe, it, expect, vi } from "vitest";
import { ReviewerAgent } from "../../src/agents/reviewerAgent.js";
import { AGENT_STAGES } from "../../src/domain/types.js";
import { env } from "../../src/config/env.js";
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
      repoPath: "/tmp/repo",
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

function makeReport(): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented things.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "42 tests passed" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Implementation looks solid.",
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "review-1",
    summary: "Reviewed changes.",
    findings: [
      { id: "f1", severity: "blocker", type: "bug", file: "src/foo.ts", title: "Bug 1", details: "d1" },
      { id: "f2", severity: "blocker", type: "bug", file: "src/foo.ts", title: "Bug 2", details: "d2" },
      {
        id: "f3",
        severity: "important",
        type: "style",
        file: "src/foo.ts",
        title: "Style",
        details: "d3",
      },
      { id: "f4", severity: "nit", type: "style", file: "src/foo.ts", title: "Nit", details: "d4" },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function buildReviewerAgent(reviewOverrides: Partial<Review> = {}) {
  let capturedInput: unknown;
  let capturedRuntime: unknown;
  let capturedStage: unknown;

  const review = makeReview(reviewOverrides);

  const agentRunner = {
    run: vi.fn().mockImplementation(async (runtime: unknown, input: unknown, stage: unknown) => {
      capturedRuntime = runtime;
      capturedInput = input;
      capturedStage = stage;
      return {
        raw: "raw reviewer transcript",
        parsed: {
          success: true,
          stage: "reviewer",
          payload: review,
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

  const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

  return {
    agent,
    artifactRepo,
    logger,
    getCaptured: () => ({ runtime: capturedRuntime, input: capturedInput, stage: capturedStage }),
    review,
  };
}

describe("ReviewerAgent.run()", () => {
  it("routes to the codex runtime with the reviewer stage and expected input", async () => {
    const { agent, getCaptured } = buildReviewerAgent();
    const taskBundle = makeTaskBundle();

    await agent.run(makePlan(), makeReport(), "diff --git a b", taskBundle, "run-1");

    const { runtime, input, stage } = getCaptured();
    expect(runtime).toBe(AGENT_STAGES.reviewer.runtime);
    expect(runtime).toBe("codex");
    expect(stage).toBe("reviewer");
    expect(input).toMatchObject({
      workingDirectory: taskBundle.repo.repoPath,
      timeoutMs: env.AGENT_TIMEOUT_MS,
      runId: "run-1",
    });
    expect(typeof (input as { prompt: string }).prompt).toBe("string");
    expect(typeof (input as { systemPrompt: string }).systemPrompt).toBe("string");
  });

  it("persists the raw transcript and the parsed review as artifacts", async () => {
    const { agent, artifactRepo, review } = buildReviewerAgent();
    const taskBundle = makeTaskBundle();

    await agent.run(makePlan(), makeReport(), "diff content", taskBundle, "run-1");

    expect(artifactRepo.create).toHaveBeenCalledTimes(2);
    expect(artifactRepo.create).toHaveBeenNthCalledWith(1, {
      runId: "run-1",
      type: "ReviewerTranscript",
      version: 3,
      payloadJson: {},
      rawText: "raw reviewer transcript",
    });
    expect(artifactRepo.create).toHaveBeenNthCalledWith(2, {
      runId: "run-1",
      type: "Review",
      version: 1,
      payloadJson: review,
      rawText: JSON.stringify(review, null, 2),
    });
  });

  it("returns the parsed review unchanged", async () => {
    const { agent, review } = buildReviewerAgent();

    const result = await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    expect(result).toEqual(review);
  });

  it("counts blocker and important findings correctly when logging completion", async () => {
    const { agent, logger, review } = buildReviewerAgent();

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      {
        runId: "run-1",
        reviewId: review.reviewId,
        verdict: review.overallVerdict,
        totalFindings: 4,
        blockerCount: 2,
        importantCount: 1,
      },
      "Review completed",
    );
  });

  it("logs zero blocker/important counts when there are no matching findings", async () => {
    const { agent, logger } = buildReviewerAgent({
      findings: [
        { id: "f1", severity: "nit", type: "style", file: "a.ts", title: "t", details: "d" },
        {
          id: "f2",
          severity: "suggestion",
          type: "style",
          file: "a.ts",
          title: "t",
          details: "d",
        },
      ],
      overallVerdict: "approved",
    });

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ blockerCount: 0, importantCount: 0, totalFindings: 2 }),
      "Review completed",
    );
  });

  it("logs the start of the reviewer run with the runId", async () => {
    const { agent, logger } = buildReviewerAgent();

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-42");

    expect(logger.info).toHaveBeenCalledWith(
      { runId: "run-42" },
      "Starting reviewer agent (Codex CLI)",
    );
  });
});
