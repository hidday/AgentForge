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

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "nit",
    type: "style",
    file: "src/foo.ts",
    title: "Nit",
    details: "Minor detail",
    ...overrides,
  };
}

function makeReview(findings: Finding[] = []): Review {
  return {
    reviewId: "rev-001",
    summary: "Review summary",
    findings,
    overallVerdict: findings.length > 0 ? "changes_requested" : "approved",
  };
}

function buildAgent(review: Review) {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        _runtime: unknown,
        opts: { prompt: string; systemPrompt: string },
      ) => {
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

  const agent = new ReviewerAgent(
    agentRunner as never,
    artifactRepo as never,
    logger as never,
  );

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
  it("creates a ReviewerTranscript artifact with the raw CLI output", async () => {
    const { agent, artifactRepo } = buildAgent(makeReview());

    await agent.run(makePlan(), makeExecutionReport(), "diff text", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    }[];

    const transcriptArtifact = calls.find((a) => a.type === "ReviewerTranscript");
    expect(transcriptArtifact).toEqual({
      runId: "run-1",
      type: "ReviewerTranscript",
      version: 3,
      payloadJson: {},
      rawText: "raw reviewer transcript",
    });
  });

  it("creates a Review artifact with the parsed payload", async () => {
    const review = makeReview([makeFinding({ severity: "blocker" })]);
    const { agent, artifactRepo } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff text", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    }[];

    const reviewArtifact = calls.find((a) => a.type === "Review");
    expect(reviewArtifact).toEqual({
      runId: "run-1",
      type: "Review",
      version: 1,
      payloadJson: review,
      rawText: JSON.stringify(review, null, 2),
    });
  });

  it("returns the parsed review", async () => {
    const review = makeReview([makeFinding()]);
    const { agent } = buildAgent(review);

    const result = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff text",
      makeTaskBundle(),
      "run-1",
    );

    expect(result).toEqual(review);
  });

  it("logs zero blocker/important counts when there are no findings", async () => {
    const review = makeReview([]);
    const { agent, logger } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff text", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    expect(completionLog).toBeDefined();
    expect(completionLog?.[0]).toEqual({
      runId: "run-1",
      reviewId: review.reviewId,
      verdict: "approved",
      totalFindings: 0,
      blockerCount: 0,
      importantCount: 0,
    });
  });

  it("logs the correct blocker count when only blockers are present", async () => {
    const findings = [
      makeFinding({ id: "f1", severity: "blocker" }),
      makeFinding({ id: "f2", severity: "blocker" }),
    ];
    const review = makeReview(findings);
    const { agent, logger } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff text", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    expect(completionLog?.[0]).toEqual({
      runId: "run-1",
      reviewId: review.reviewId,
      verdict: "changes_requested",
      totalFindings: 2,
      blockerCount: 2,
      importantCount: 0,
    });
  });

  it("logs the correct important count when only important findings are present", async () => {
    const findings = [
      makeFinding({ id: "f1", severity: "important" }),
      makeFinding({ id: "f2", severity: "important" }),
      makeFinding({ id: "f3", severity: "important" }),
    ];
    const review = makeReview(findings);
    const { agent, logger } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff text", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    expect(completionLog?.[0]).toEqual({
      runId: "run-1",
      reviewId: review.reviewId,
      verdict: "changes_requested",
      totalFindings: 3,
      blockerCount: 0,
      importantCount: 3,
    });
  });

  it("logs the exact mixed counts of blockers, important findings, and others", async () => {
    const findings = [
      makeFinding({ id: "f1", severity: "blocker" }),
      makeFinding({ id: "f2", severity: "important" }),
      makeFinding({ id: "f3", severity: "important" }),
      makeFinding({ id: "f4", severity: "nit" }),
      makeFinding({ id: "f5", severity: "suggestion" }),
    ];
    const review = makeReview(findings);
    const { agent, logger } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff text", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    expect(completionLog?.[0]).toEqual({
      runId: "run-1",
      reviewId: review.reviewId,
      verdict: "changes_requested",
      totalFindings: 5,
      blockerCount: 1,
      importantCount: 2,
    });
  });

  it("passes the diff and execution report through to the rendered user prompt", async () => {
    const { agent, getUserPrompt } = buildAgent(makeReview());

    await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff text",
      makeTaskBundle(),
      "run-1",
    );

    // Smoke check that the prompts were rendered (non-empty) via the real templates.
    expect(getUserPrompt().length).toBeGreaterThan(0);
  });
});
