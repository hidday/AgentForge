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
    summary: "Implemented the change.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Looks solid.",
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
    summary: "Found a couple of issues.",
    findings: [
      {
        id: "f1",
        severity: "blocker",
        type: "bug",
        file: "src/foo.ts",
        lineHint: 10,
        title: "Null pointer",
        details: "Will crash.",
      },
      {
        id: "f2",
        severity: "important",
        type: "bug",
        file: "src/foo.ts",
        title: "Missing validation",
        details: "Edge case not handled.",
      },
      {
        id: "f3",
        severity: "nit",
        type: "style",
        file: "src/foo.ts",
        title: "Formatting",
        details: "Minor style nit.",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function buildReviewerAgent(reviewOverride?: Review) {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (_runtime: unknown, opts: { prompt: string; systemPrompt: string }) => {
        capturedSystemPrompt = opts.systemPrompt;
        capturedUserPrompt = opts.prompt;
        return {
          raw: "raw reviewer transcript",
          parsed: {
            payload: reviewOverride ?? makeReview(),
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
  };
}

describe("ReviewerAgent.run()", () => {
  it("renders the plan, execution report, and diff into the prompts", async () => {
    const { agent, getUserPrompt } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/x b/x", makeTaskBundle(), "run-1");

    const prompt = getUserPrompt();
    expect(prompt).toContain("Test plan");
    expect(prompt).toContain("Implemented the change.");
  });

  it("persists a ReviewerTranscript artifact with the raw output", async () => {
    const { agent, artifactRepo } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(artifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        type: "ReviewerTranscript",
        rawText: "raw reviewer transcript",
      }),
    );
  });

  it("persists a Review artifact with the parsed payload", async () => {
    const { agent, artifactRepo } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(artifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        type: "Review",
        version: 1,
        payloadJson: expect.objectContaining({ reviewId: "rev-001" }),
      }),
    );
  });

  it("returns the parsed review payload", async () => {
    const { agent } = buildReviewerAgent();

    const result = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff",
      makeTaskBundle(),
      "run-1",
    );

    expect(result.reviewId).toBe("rev-001");
    expect(result.findings).toHaveLength(3);
    expect(result.overallVerdict).toBe("changes_requested");
  });

  it("logs blocker and important finding counts on completion", async () => {
    const { agent, logger } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.blockerCount).toBe(1);
    expect(payload?.importantCount).toBe(1);
    expect(payload?.totalFindings).toBe(3);
    expect(payload?.verdict).toBe("changes_requested");
  });

  it("reports zero blockers and importants when the review approves with only nits", async () => {
    const approvedReview = makeReview({
      overallVerdict: "approved",
      findings: [
        {
          id: "f1",
          severity: "nit",
          type: "style",
          file: "src/foo.ts",
          title: "Style nit",
          details: "Minor.",
        },
      ],
    });
    const { agent, logger } = buildReviewerAgent(approvedReview);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.blockerCount).toBe(0);
    expect(payload?.importantCount).toBe(0);
    expect(payload?.verdict).toBe("approved");
  });
});
