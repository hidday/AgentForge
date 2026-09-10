import { describe, it, expect, vi } from "vitest";
import { ReviewerAgent } from "../../src/agents/reviewerAgent.js";
import { AGENT_STAGES } from "../../src/domain/types.js";
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
    summary: "Looks decent",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function buildReviewerAgent(review: Review = makeReview()) {
  let capturedRuntime: unknown;
  let capturedOpts: { prompt: string; systemPrompt: string } | undefined;
  let capturedStage: unknown;

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (runtime: unknown, opts: { prompt: string; systemPrompt: string }, stage: unknown) => {
        capturedRuntime = runtime;
        capturedOpts = opts;
        capturedStage = stage;
        return {
          raw: "raw reviewer transcript",
          parsed: {
            stage: "reviewer" as const,
            success: true,
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
    getRuntime: () => capturedRuntime,
    getStage: () => capturedStage,
    getSystemPrompt: () => capturedOpts?.systemPrompt ?? "",
    getUserPrompt: () => capturedOpts?.prompt ?? "",
  };
}

describe("ReviewerAgent.run()", () => {
  it("renders prompts from the real templates, interpolating plan/executionReport/diff/taskBundle fields", async () => {
    const { agent, getSystemPrompt, getUserPrompt } = buildReviewerAgent();
    const plan = makePlan();
    const report = makeExecutionReport();
    const bundle = makeTaskBundle();
    const diff = "diff --git a/src/foo.ts b/src/foo.ts\n+added line";

    await agent.run(plan, report, diff, bundle, "run-1");

    const systemPrompt = getSystemPrompt();
    expect(systemPrompt).toContain("senior software engineer acting as a code reviewer");
    expect(systemPrompt).toContain("BEGIN_STRUCTURED_OUTPUT");

    const userPrompt = getUserPrompt();
    expect(userPrompt).toContain(bundle.issue.id);
    expect(userPrompt).toContain(bundle.issue.title);
    expect(userPrompt).toContain(bundle.issue.description);
    expect(userPrompt).toContain(String(plan.planVersion));
    expect(userPrompt).toContain(plan.summary);
    expect(userPrompt).toContain(report.summary);
    expect(userPrompt).toContain(diff);
    expect(userPrompt).toContain("pass");
    expect(userPrompt).not.toContain("{{");
  });

  it("calls agentRunner.run with the reviewer stage runtime and stage name", async () => {
    const { agent, getRuntime, getStage } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(getRuntime()).toBe(AGENT_STAGES.reviewer.runtime);
    expect(getStage()).toBe("reviewer");
  });

  it("creates a ReviewerTranscript artifact (v3, raw output, empty payload) then a Review artifact (v1) in order", async () => {
    const review = makeReview({ reviewId: "rev-42" });
    const { agent, artifactRepo } = buildReviewerAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(artifactRepo.create).toHaveBeenCalledTimes(2);

    const firstCall = artifactRepo.create.mock.calls[0]?.[0] as {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    };
    expect(firstCall.type).toBe("ReviewerTranscript");
    expect(firstCall.version).toBe(3);
    expect(firstCall.rawText).toBe("raw reviewer transcript");
    expect(firstCall.payloadJson).toEqual({});
    expect(firstCall.runId).toBe("run-1");

    const secondCall = artifactRepo.create.mock.calls[1]?.[0] as {
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    };
    expect(secondCall.type).toBe("Review");
    expect(secondCall.version).toBe(1);
    expect(secondCall.payloadJson).toEqual(review);
    expect(secondCall.rawText).toBe(JSON.stringify(review, null, 2));
  });

  it("returns the parsed review payload", async () => {
    const review = makeReview({ reviewId: "rev-return-check" });
    const { agent } = buildReviewerAgent(review);

    const result = await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(result).toEqual(review);
  });

  it("logs blockerCount and importantCount computed by filtering findings across mixed severities", async () => {
    const review = makeReview({
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t1", details: "d1" },
        { id: "f2", severity: "important", type: "bug", file: "b.ts", title: "t2", details: "d2" },
        { id: "f3", severity: "blocker", type: "bug", file: "c.ts", title: "t3", details: "d3" },
        { id: "f4", severity: "suggestion", type: "style", file: "d.ts", title: "t4", details: "d4" },
        { id: "f5", severity: "nit", type: "style", file: "e.ts", title: "t5", details: "d5" },
      ],
      overallVerdict: "changes_requested",
    });
    const { agent, logger } = buildReviewerAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.reviewId).toBe(review.reviewId);
    expect(payload?.verdict).toBe("changes_requested");
    expect(payload?.totalFindings).toBe(5);
    expect(payload?.blockerCount).toBe(2);
    expect(payload?.importantCount).toBe(1);
  });

  it("logs a starting message before running the agent", async () => {
    const { agent, logger } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-9");

    const startLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Starting reviewer agent (Codex CLI)",
    );
    expect(startLog).toBeDefined();
    expect((startLog?.[0] as { runId?: string })?.runId).toBe("run-9");
  });
});
