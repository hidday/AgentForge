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
    summary: "Implemented the feature.",
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
    summary: "Mostly good with a couple of issues.",
    findings: [
      {
        id: "f1",
        severity: "blocker",
        type: "bug",
        file: "src/foo.ts",
        title: "Null deref",
        details: "Will crash on null input",
      },
      {
        id: "f2",
        severity: "important",
        type: "bug",
        file: "src/foo.ts",
        title: "Missing error handling",
        details: "Unhandled rejection",
      },
      {
        id: "f3",
        severity: "nit",
        type: "style",
        file: "src/foo.ts",
        title: "Naming",
        details: "Rename variable",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function buildReviewerAgent(reviewOverride?: Review) {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";
  let capturedWorkingDirectory = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        _runtime: unknown,
        opts: { prompt: string; systemPrompt: string; workingDirectory: string },
      ) => {
        capturedSystemPrompt = opts.systemPrompt;
        capturedUserPrompt = opts.prompt;
        capturedWorkingDirectory = opts.workingDirectory;
        return {
          raw: "raw reviewer transcript",
          parsed: {
            stage: "reviewer" as const,
            payload: reviewOverride ?? makeReview(),
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
    getWorkingDirectory: () => capturedWorkingDirectory,
  };
}

describe("ReviewerAgent.run()", () => {
  it("renders the plan, execution report, and diff into the prompts", async () => {
    const { agent, getSystemPrompt, getUserPrompt, getWorkingDirectory } = buildReviewerAgent();
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/f b/f", bundle, "run-1");

    expect(getSystemPrompt().length).toBeGreaterThan(0);
    expect(getUserPrompt()).toContain("Test plan");
    expect(getUserPrompt()).toContain("Implemented the feature.");
    expect(getWorkingDirectory()).toBe("/tmp/repo");
  });

  it("writes a ReviewerTranscript artifact (version 3) with the raw output", async () => {
    const { agent, artifactRepo } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff text", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      runId: string;
      type: string;
      version: number;
      rawText: string;
    }[];
    const transcript = calls.find((c) => c.type === "ReviewerTranscript");
    expect(transcript).toBeDefined();
    expect(transcript?.version).toBe(3);
    expect(transcript?.runId).toBe("run-1");
    expect(transcript?.rawText).toBe("raw reviewer transcript");
  });

  it("writes a Review artifact (version 1) with the parsed review payload", async () => {
    const { agent, artifactRepo } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff text", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      type: string;
      version: number;
      payloadJson: unknown;
    }[];
    const reviewArtifact = calls.find((c) => c.type === "Review");
    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact?.version).toBe(1);
    expect((reviewArtifact?.payloadJson as Review).reviewId).toBe("rev-001");
  });

  it("returns the parsed review and logs blocker/important finding counts", async () => {
    const { agent, logger } = buildReviewerAgent();

    const result = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff text",
      makeTaskBundle(),
      "run-1",
    );

    expect(result.reviewId).toBe("rev-001");
    expect(result.overallVerdict).toBe("changes_requested");
    expect(result.findings).toHaveLength(3);

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.blockerCount).toBe(1);
    expect(payload.importantCount).toBe(1);
    expect(payload.totalFindings).toBe(3);
    expect(payload.verdict).toBe("changes_requested");
  });

  it("logs zero blocker/important counts for an approved review with only nits", async () => {
    const approvedReview = makeReview({
      overallVerdict: "approved",
      findings: [
        {
          id: "f1",
          severity: "nit",
          type: "style",
          file: "src/foo.ts",
          title: "Nit",
          details: "Minor",
        },
      ],
    });
    const { agent, logger } = buildReviewerAgent(approvedReview);

    const result = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff text",
      makeTaskBundle(),
      "run-1",
    );

    expect(result.overallVerdict).toBe("approved");
    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.blockerCount).toBe(0);
    expect(payload.importantCount).toBe(0);
  });
});
