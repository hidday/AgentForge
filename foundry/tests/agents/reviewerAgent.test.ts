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

function makeReview(): Review {
  return {
    reviewId: "rev-001",
    summary: "Two blockers, one important issue, plus minor notes.",
    findings: [
      {
        id: "f1",
        severity: "blocker",
        type: "bug",
        file: "src/foo.ts",
        lineHint: 10,
        title: "Null deref",
        details: "Will crash on empty input",
      },
      {
        id: "f2",
        severity: "blocker",
        type: "security",
        file: "src/bar.ts",
        title: "Unsanitized input",
        details: "SQL injection risk",
      },
      {
        id: "f3",
        severity: "important",
        type: "bug",
        file: "src/baz.ts",
        title: "Off-by-one",
        details: "Loop bound is wrong",
      },
      {
        id: "f4",
        severity: "suggestion",
        type: "style",
        file: "src/foo.ts",
        title: "Extract helper",
        details: "Could be simplified",
      },
      {
        id: "f5",
        severity: "nit",
        type: "style",
        file: "src/foo.ts",
        title: "Long line",
        details: "Wrap for readability",
      },
    ],
    overallVerdict: "changes_requested",
  };
}

function buildAgent(reviewOverride?: Review) {
  const review = reviewOverride ?? makeReview();

  const agentRunner = {
    run: vi.fn().mockResolvedValue({
      raw: "raw reviewer transcript",
      parsed: {
        stage: "reviewer" as const,
        payload: review,
      },
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, agentRunner, artifactRepo, logger, review };
}

describe("ReviewerAgent.run()", () => {
  it("persists a ReviewerTranscript artifact with the raw agent output", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/foo b/foo", makeTaskBundle(), "run-1");

    expect(artifactRepo.create).toHaveBeenCalledWith({
      runId: "run-1",
      type: "ReviewerTranscript",
      version: 3,
      payloadJson: {},
      rawText: "raw reviewer transcript",
    });
  });

  it("persists a Review artifact whose payload and rawText mirror the parsed review", async () => {
    const { agent, artifactRepo, review } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/foo b/foo", makeTaskBundle(), "run-1");

    expect(artifactRepo.create).toHaveBeenCalledWith({
      runId: "run-1",
      type: "Review",
      version: 1,
      payloadJson: review,
      rawText: JSON.stringify(review, null, 2),
    });
  });

  it("returns the review from the agent runner's parsed payload", async () => {
    const { agent, review } = buildAgent();

    const result = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff --git a/foo b/foo",
      makeTaskBundle(),
      "run-1",
    );

    expect(result).toBe(review);
    expect(result).toEqual(review);
  });

  it("logs the correct blocker and important finding counts on completion", async () => {
    const { agent, logger, review } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/foo b/foo", makeTaskBundle(), "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      {
        runId: "run-1",
        reviewId: review.reviewId,
        verdict: review.overallVerdict,
        totalFindings: 5,
        blockerCount: 2,
        importantCount: 1,
      },
      "Review completed",
    );
  });

  it("logs zero blocker/important counts when there are no matching findings", async () => {
    const cleanReview: Review = {
      reviewId: "rev-clean",
      summary: "Nothing but nits.",
      findings: [
        {
          id: "f1",
          severity: "nit",
          type: "style",
          file: "src/foo.ts",
          title: "Long line",
          details: "Wrap for readability",
        },
      ],
      overallVerdict: "approved",
    };
    const { agent, logger } = buildAgent(cleanReview);

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/foo b/foo", makeTaskBundle(), "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      {
        runId: "run-1",
        reviewId: "rev-clean",
        verdict: "approved",
        totalFindings: 1,
        blockerCount: 0,
        importantCount: 0,
      },
      "Review completed",
    );
  });

  it("passes the reviewer runtime call with the rendered prompts and repo working directory", async () => {
    const { agent, agentRunner } = buildAgent();
    const taskBundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/foo b/foo", taskBundle, "run-1");

    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    const [runtime, opts, name] = agentRunner.run.mock.calls[0];
    expect(runtime).toBeDefined();
    expect(name).toBe("reviewer");
    expect((opts as { workingDirectory: string }).workingDirectory).toBe(taskBundle.repo.repoPath);
    expect((opts as { runId: string }).runId).toBe("run-1");
    expect((opts as { prompt: string }).prompt).toEqual(expect.any(String));
    expect((opts as { systemPrompt: string }).systemPrompt).toEqual(expect.any(String));
  });
});
