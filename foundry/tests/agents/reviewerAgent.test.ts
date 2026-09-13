import { describe, it, expect, vi } from "vitest";
import { ReviewerAgent } from "../../src/agents/reviewerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review, Finding } from "../../src/schemas/review.js";

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
      repoPath: "/tmp/repo-path",
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
    summary: "Plan summary text",
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
    summary: "Execution summary text",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Solid implementation.",
  };
}

function makeFindings(): Finding[] {
  return [
    {
      id: "f1",
      severity: "blocker",
      type: "bug",
      file: "src/foo.ts",
      title: "Bug",
      details: "Details 1",
    },
    {
      id: "f2",
      severity: "blocker",
      type: "bug",
      file: "src/foo.ts",
      title: "Bug 2",
      details: "Details 2",
    },
    {
      id: "f3",
      severity: "important",
      type: "test-coverage",
      file: "src/bar.ts",
      title: "Missing tests",
      details: "Details 3",
    },
    {
      id: "f4",
      severity: "nit",
      type: "style",
      file: "src/baz.ts",
      title: "Style nit",
      details: "Details 4",
    },
  ];
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Review summary",
    findings: makeFindings(),
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function buildReviewerAgent(review: Review = makeReview()) {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";
  let capturedRuntime: unknown;
  let capturedOpts: unknown;
  let capturedStageName: unknown;

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        runtime: unknown,
        opts: { prompt: string; systemPrompt: string },
        stageName: unknown,
      ) => {
        capturedRuntime = runtime;
        capturedOpts = opts;
        capturedStageName = stageName;
        capturedSystemPrompt = opts.systemPrompt;
        capturedUserPrompt = opts.prompt;
        return {
          raw: "raw reviewer transcript",
          parsed: {
            stage: "reviewer" as const,
            payload: review,
          },
        };
      },
    ),
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

  return {
    agent,
    agentRunner,
    artifactRepo,
    logger,
    getSystemPrompt: () => capturedSystemPrompt,
    getUserPrompt: () => capturedUserPrompt,
    getRuntime: () => capturedRuntime,
    getOpts: () => capturedOpts as { workingDirectory: string; timeoutMs: number; runId: string },
    getStageName: () => capturedStageName,
  };
}

describe("ReviewerAgent.run()", () => {
  it("invokes the agent runner with the codex runtime, correct stage name, and call options", async () => {
    const { agent, getRuntime, getStageName, getOpts } = buildReviewerAgent();
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makeReport(), "diff content", bundle, "run-1");

    expect(getRuntime()).toBe("codex");
    expect(getStageName()).toBe("reviewer");
    const opts = getOpts();
    expect(opts.workingDirectory).toBe(bundle.repo.repoPath);
    expect(opts.runId).toBe("run-1");
    expect(typeof opts.timeoutMs).toBe("number");
  });

  it("renders the user prompt with issue, plan, and execution report content", async () => {
    const { agent, getUserPrompt } = buildReviewerAgent();
    const bundle = makeTaskBundle();
    const plan = makePlan();
    const report = makeReport();

    await agent.run(plan, report, "the diff text", bundle, "run-1");

    const prompt = getUserPrompt();
    expect(prompt).toContain(bundle.issue.id);
    expect(prompt).toContain(bundle.issue.title);
    expect(prompt).toContain(plan.summary);
    expect(prompt).toContain(report.summary);
  });

  it("renders a non-empty system prompt from the reviewer system template", async () => {
    const { agent, getSystemPrompt } = buildReviewerAgent();

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    const systemPrompt = getSystemPrompt();
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(systemPrompt).toContain("code reviewer");
  });

  it("persists a ReviewerTranscript artifact with version 3 and the raw output", async () => {
    const { agent, artifactRepo } = buildReviewerAgent();

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-42");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]);
    const transcript = calls.find((c: { type: string }) => c.type === "ReviewerTranscript");
    expect(transcript).toMatchObject({
      runId: "run-42",
      type: "ReviewerTranscript",
      version: 3,
      payloadJson: {},
      rawText: "raw reviewer transcript",
    });
  });

  it("persists a Review artifact with version 1 and the review as JSON", async () => {
    const review = makeReview({ reviewId: "rev-99" });
    const { agent, artifactRepo } = buildReviewerAgent(review);

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]);
    const reviewArtifact = calls.find((c: { type: string }) => c.type === "Review");
    expect(reviewArtifact).toMatchObject({
      runId: "run-1",
      type: "Review",
      version: 1,
      payloadJson: review,
      rawText: JSON.stringify(review, null, 2),
    });
  });

  it("returns the parsed review", async () => {
    const review = makeReview({ overallVerdict: "approved" });
    const { agent } = buildReviewerAgent(review);

    const result = await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    expect(result).toEqual(review);
  });

  it("logs blocker and important finding counts computed from the findings array", async () => {
    const review = makeReview();
    const { agent, logger } = buildReviewerAgent(review);

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        reviewId: review.reviewId,
        verdict: review.overallVerdict,
        totalFindings: 4,
        blockerCount: 2,
        importantCount: 1,
      }),
      "Review completed",
    );
  });

  it("logs zero blocker/important counts when there are no findings of those severities", async () => {
    const review = makeReview({
      findings: [
        {
          id: "f1",
          severity: "nit",
          type: "style",
          file: "src/a.ts",
          title: "Nit",
          details: "Minor",
        },
      ],
      overallVerdict: "approved",
    });
    const { agent, logger } = buildReviewerAgent(review);

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ blockerCount: 0, importantCount: 0, totalFindings: 1 }),
      "Review completed",
    );
  });

  it("logs the start of the reviewer agent run", async () => {
    const { agent, logger } = buildReviewerAgent();

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-77");

    expect(logger.info).toHaveBeenCalledWith(
      { runId: "run-77" },
      "Starting reviewer agent (Codex CLI)",
    );
  });
});
