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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
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
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
    summary: "Looks good overall.",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function buildReviewerAgent(review: Review = makeReview(), raw = "raw reviewer transcript") {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";
  let capturedRuntime: unknown;
  let capturedStage: unknown;

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        runtime: unknown,
        opts: { prompt: string; systemPrompt: string },
        stage: unknown,
      ) => {
        capturedRuntime = runtime;
        capturedStage = stage;
        capturedSystemPrompt = opts.systemPrompt;
        capturedUserPrompt = opts.prompt;
        return {
          raw,
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
    getStage: () => capturedStage,
  };
}

describe("ReviewerAgent.run()", () => {
  it("logs start, runs the agentRunner with the codex runtime and 'reviewer' stage, and returns the review", async () => {
    const review = makeReview({ overallVerdict: "approved" });
    const { agent, agentRunner, logger, getRuntime, getStage } = buildReviewerAgent(review);

    const result = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff --git a/foo.ts b/foo.ts",
      makeTaskBundle(),
      "run-1",
    );

    expect(logger.info).toHaveBeenCalledWith(
      { runId: "run-1" },
      "Starting reviewer agent (Codex CLI)",
    );
    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    expect(getRuntime()).toBe("codex");
    expect(getStage()).toBe("reviewer");
    expect(result).toEqual(review);
  });

  it("renders the issue, plan and execution report details into the prompts", async () => {
    const { agent, getSystemPrompt, getUserPrompt } = buildReviewerAgent();

    const plan = makePlan();
    const executionReport = makeExecutionReport({ summary: "Added the widget feature." });
    const taskBundle = makeTaskBundle();

    await agent.run(plan, executionReport, "diff content here", taskBundle, "run-1");

    const userPrompt = getUserPrompt();
    expect(userPrompt).toContain(taskBundle.issue.id);
    expect(userPrompt).toContain(taskBundle.issue.title);
    expect(userPrompt).toContain(plan.summary);
    expect(userPrompt).toContain("Added the widget feature.");
    expect(userPrompt).toContain("diff content here");
    expect(userPrompt).not.toContain("{{diff}}");

    const systemPrompt = getSystemPrompt();
    expect(systemPrompt).toContain("code reviewer");
    expect(systemPrompt).not.toContain("{{");
  });

  it("passes the repo path and configured timeout as the working directory / timeoutMs", async () => {
    const { agent, agentRunner } = buildReviewerAgent();
    const taskBundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff", taskBundle, "run-42");

    const callArgs = agentRunner.run.mock.calls[0];
    const opts = callArgs[1] as { workingDirectory: string; timeoutMs: number; runId: string };
    expect(opts.workingDirectory).toBe(taskBundle.repo.repoPath);
    expect(opts.runId).toBe("run-42");
    expect(typeof opts.timeoutMs).toBe("number");
    expect(opts.timeoutMs).toBeGreaterThan(0);
  });

  it("persists a ReviewerTranscript artifact (version 3) with the raw CLI output", async () => {
    const { agent, artifactRepo } = buildReviewerAgent(makeReview(), "the raw transcript text");

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as Array<{
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    }>;
    const transcriptArtifact = calls.find((a) => a.type === "ReviewerTranscript");

    expect(transcriptArtifact).toBeDefined();
    expect(transcriptArtifact?.runId).toBe("run-1");
    expect(transcriptArtifact?.version).toBe(3);
    expect(transcriptArtifact?.payloadJson).toEqual({});
    expect(transcriptArtifact?.rawText).toBe("the raw transcript text");
  });

  it("persists a Review artifact (version 1) with the parsed review as JSON", async () => {
    const review = makeReview({
      reviewId: "rev-777",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "bug",
          file: "src/foo.ts",
          title: "Null pointer",
          details: "Could throw on empty input",
        },
      ],
      overallVerdict: "changes_requested",
    });
    const { agent, artifactRepo } = buildReviewerAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as Array<{
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    }>;
    const reviewArtifact = calls.find((a) => a.type === "Review");

    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact?.version).toBe(1);
    expect(reviewArtifact?.payloadJson).toEqual(review);
    expect(reviewArtifact?.rawText).toBe(JSON.stringify(review, null, 2));
  });

  it("creates the ReviewerTranscript artifact before the Review artifact", async () => {
    const { agent, artifactRepo } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const types = artifactRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { type: string }).type,
    );
    expect(types).toEqual(["ReviewerTranscript", "Review"]);
  });

  it("counts blocker and important findings correctly in the completion log, ignoring other severities", async () => {
    const review = makeReview({
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t1", details: "d1" },
        { id: "f2", severity: "blocker", type: "bug", file: "b.ts", title: "t2", details: "d2" },
        {
          id: "f3",
          severity: "important",
          type: "design",
          file: "c.ts",
          title: "t3",
          details: "d3",
        },
        {
          id: "f4",
          severity: "suggestion",
          type: "style",
          file: "d.ts",
          title: "t4",
          details: "d4",
        },
        { id: "f5", severity: "nit", type: "style", file: "e.ts", title: "t5", details: "d5" },
      ],
    });
    const { agent, logger } = buildReviewerAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.runId).toBe("run-1");
    expect(payload.reviewId).toBe(review.reviewId);
    expect(payload.verdict).toBe("approved");
    expect(payload.totalFindings).toBe(5);
    expect(payload.blockerCount).toBe(2);
    expect(payload.importantCount).toBe(1);
  });

  it("reports zero blocker/important counts and total findings when there are no findings", async () => {
    const review = makeReview({ findings: [] });
    const { agent, logger } = buildReviewerAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.totalFindings).toBe(0);
    expect(payload.blockerCount).toBe(0);
    expect(payload.importantCount).toBe(0);
    expect(payload.verdict).toBe("approved");
  });

  it("propagates an error and never writes artifacts when the agent runner rejects", async () => {
    const agentRunner = {
      run: vi.fn().mockRejectedValue(new Error("CLI crashed")),
    };
    const artifactRepo = {
      create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

    await expect(
      agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1"),
    ).rejects.toThrow("CLI crashed");

    expect(artifactRepo.create).not.toHaveBeenCalled();
  });

  it("propagates an error when persisting the ReviewerTranscript artifact fails, and never writes the Review artifact", async () => {
    const agentRunner = {
      run: vi.fn().mockResolvedValue({
        raw: "raw",
        parsed: { stage: "reviewer" as const, payload: makeReview() },
      }),
    };
    const artifactRepo = {
      create: vi.fn().mockRejectedValueOnce(new Error("db write failed")),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

    await expect(
      agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1"),
    ).rejects.toThrow("db write failed");

    expect(artifactRepo.create).toHaveBeenCalledTimes(1);
  });
});
