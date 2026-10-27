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

function makeReview(findings: Review["findings"] = []): Review {
  return {
    reviewId: "rev-001",
    summary: "Looks ok",
    findings,
    overallVerdict: findings.length > 0 ? "changes_requested" : "approved",
  };
}

function buildReviewerAgent(reviewOverride?: Review) {
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
  it("renders the plan, execution report, and diff into the user prompt", async () => {
    const { agent, getUserPrompt } = buildReviewerAgent();

    await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff --git a/src/foo.ts b/src/foo.ts",
      makeTaskBundle(),
      "run-1",
    );

    const prompt = getUserPrompt();
    expect(prompt).toContain("LIN-1");
    expect(prompt).toContain("Test issue");
    expect(prompt).toContain("Approved Plan (v1)");
    expect(prompt).toContain("Test plan");
    expect(prompt).toContain("Implemented things.");
    expect(prompt).toContain("Lint: pass");
    expect(prompt).toContain("Tests: pass");
    expect(prompt).toContain("diff --git a/src/foo.ts b/src/foo.ts");
    expect(prompt).not.toContain("{{plan.summary}}");
    expect(prompt).not.toContain("{{diff}}");
  });

  it("writes a ReviewerTranscript artifact (version 3) and a Review artifact (version 1)", async () => {
    const { agent, artifactRepo } = buildReviewerAgent();

    await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff text",
      makeTaskBundle(),
      "run-1",
    );

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    }[];

    const transcriptArtifact = calls.find((a) => a.type === "ReviewerTranscript");
    expect(transcriptArtifact).toBeDefined();
    expect(transcriptArtifact?.version).toBe(3);
    expect(transcriptArtifact?.rawText).toBe("raw reviewer transcript");

    const reviewArtifact = calls.find((a) => a.type === "Review");
    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact?.version).toBe(1);
    expect((reviewArtifact?.payloadJson as { reviewId: string }).reviewId).toBe("rev-001");
  });

  it("returns the parsed review payload", async () => {
    const review = makeReview([
      {
        id: "f1",
        severity: "blocker",
        type: "bug",
        file: "src/foo.ts",
        title: "Null deref",
        details: "Will throw",
      },
    ]);
    const { agent } = buildReviewerAgent(review);

    const result = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff text",
      makeTaskBundle(),
      "run-1",
    );

    expect(result.reviewId).toBe("rev-001");
    expect(result.overallVerdict).toBe("changes_requested");
    expect(result.findings).toHaveLength(1);
  });

  it("logs blockerCount and importantCount computed from findings by severity", async () => {
    const review = makeReview([
      {
        id: "f1",
        severity: "blocker",
        type: "bug",
        file: "src/foo.ts",
        title: "Blocker 1",
        details: "details",
      },
      {
        id: "f2",
        severity: "blocker",
        type: "bug",
        file: "src/foo.ts",
        title: "Blocker 2",
        details: "details",
      },
      {
        id: "f3",
        severity: "important",
        type: "design",
        file: "src/foo.ts",
        title: "Important 1",
        details: "details",
      },
      {
        id: "f4",
        severity: "nit",
        type: "style",
        file: "src/foo.ts",
        title: "Nit 1",
        details: "details",
      },
    ]);
    const { agent, logger } = buildReviewerAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff text", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.blockerCount).toBe(2);
    expect(payload?.importantCount).toBe(1);
    expect(payload?.totalFindings).toBe(4);
    expect(payload?.verdict).toBe("changes_requested");
    expect(payload?.reviewId).toBe("rev-001");
  });

  it("logs zero blockerCount and importantCount when there are no findings", async () => {
    const { agent, logger } = buildReviewerAgent(makeReview([]));

    await agent.run(makePlan(), makeExecutionReport(), "diff text", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.blockerCount).toBe(0);
    expect(payload?.importantCount).toBe(0);
    expect(payload?.totalFindings).toBe(0);
    expect(payload?.verdict).toBe("approved");
  });

  it("passes the taskBundle's repoPath as the agent runner's workingDirectory", async () => {
    const { agent, agentRunner } = buildReviewerAgent();
    const bundle = makeTaskBundle();
    bundle.repo.repoPath = "/workspace/custom-repo";

    await agent.run(makePlan(), makeExecutionReport(), "diff text", bundle, "run-1");

    expect(agentRunner.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workingDirectory: "/workspace/custom-repo", runId: "run-1" }),
      "reviewer",
      expect.anything(),
    );
  });
});
