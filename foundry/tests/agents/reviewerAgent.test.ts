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
    scoreRationale: "Looks solid.",
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "review-001",
    summary: "Looks reasonable, minor nits.",
    findings: [
      { id: "f1", severity: "nit", type: "style", file: "src/foo.ts", title: "Nit", details: "d" },
    ],
    overallVerdict: "approved",
    ...overrides,
  };
}

function buildReviewerAgent(reviewOverrides: Partial<Review> = {}) {
  let capturedRuntime: unknown;
  let capturedOpts: { prompt: string; systemPrompt: string; workingDirectory: string; timeoutMs: number; runId: string } | undefined;
  let capturedStage: unknown;
  let capturedSchema: unknown;

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        runtime: unknown,
        opts: { prompt: string; systemPrompt: string; workingDirectory: string; timeoutMs: number; runId: string },
        stage: unknown,
        schema: unknown,
      ) => {
        capturedRuntime = runtime;
        capturedOpts = opts;
        capturedStage = stage;
        capturedSchema = schema;
        return {
          raw: "raw reviewer transcript",
          parsed: {
            stage: "reviewer" as const,
            success: true,
            payload: makeReview(reviewOverrides),
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
    getRuntime: () => capturedRuntime,
    getOpts: () => capturedOpts,
    getStage: () => capturedStage,
    getSchema: () => capturedSchema,
  };
}

describe("ReviewerAgent.run()", () => {
  it("logs the start of the reviewer agent", async () => {
    const { agent, logger } = buildReviewerAgent();

    await agent.run(makePlan(), makeReport(), "diff --git a b", makeTaskBundle(), "run-1");

    expect(logger.info).toHaveBeenCalledWith({ runId: "run-1" }, "Starting reviewer agent (Codex CLI)");
  });

  it("invokes agentRunner.run with the codex runtime, 'reviewer' stage, and renders the prompts", async () => {
    const { agent, getRuntime, getOpts, getStage } = buildReviewerAgent();
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makeReport(), "diff --git a/foo b/foo", bundle, "run-1");

    expect(getRuntime()).toBe("codex");
    expect(getStage()).toBe("reviewer");
    const opts = getOpts();
    expect(opts).toBeDefined();
    expect(opts?.workingDirectory).toBe(bundle.repo.repoPath);
    expect(opts?.runId).toBe("run-1");
    expect(typeof opts?.systemPrompt).toBe("string");
    expect(opts?.systemPrompt.length).toBeGreaterThan(0);
    expect(typeof opts?.prompt).toBe("string");
    expect(opts?.prompt.length).toBeGreaterThan(0);
  });

  it("persists a ReviewerTranscript artifact with the raw CLI output and version 3", async () => {
    const { agent, artifactRepo } = buildReviewerAgent();

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as Record<
      string,
      unknown
    >[];
    const transcript = calls.find((a) => a.type === "ReviewerTranscript");
    expect(transcript).toBeDefined();
    expect(transcript?.runId).toBe("run-1");
    expect(transcript?.version).toBe(3);
    expect(transcript?.rawText).toBe("raw reviewer transcript");
  });

  it("persists a Review artifact (version 1) with the parsed payload", async () => {
    const { agent, artifactRepo } = buildReviewerAgent({ reviewId: "review-xyz" });

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as Record<
      string,
      unknown
    >[];
    const reviewArtifact = calls.find((a) => a.type === "Review");
    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact?.version).toBe(1);
    expect((reviewArtifact?.payloadJson as Review).reviewId).toBe("review-xyz");
    expect(typeof reviewArtifact?.rawText).toBe("string");
  });

  it("returns the parsed Review object", async () => {
    const { agent } = buildReviewerAgent({ overallVerdict: "changes_requested" });

    const review = await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    expect(review.overallVerdict).toBe("changes_requested");
  });

  it("logs completion with blocker/important counts derived from findings", async () => {
    const { agent, logger } = buildReviewerAgent({
      reviewId: "review-counts",
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t1", details: "d1" },
        { id: "f2", severity: "blocker", type: "bug", file: "b.ts", title: "t2", details: "d2" },
        { id: "f3", severity: "important", type: "style", file: "c.ts", title: "t3", details: "d3" },
        { id: "f4", severity: "nit", type: "style", file: "d.ts", title: "t4", details: "d4" },
      ],
    });

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.reviewId).toBe("review-counts");
    expect(payload.verdict).toBe("changes_requested");
    expect(payload.totalFindings).toBe(4);
    expect(payload.blockerCount).toBe(2);
    expect(payload.importantCount).toBe(1);
  });

  it("logs zero blocker/important counts when there are no findings", async () => {
    const { agent, logger } = buildReviewerAgent({ findings: [] });

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.totalFindings).toBe(0);
    expect(payload.blockerCount).toBe(0);
    expect(payload.importantCount).toBe(0);
  });
});
