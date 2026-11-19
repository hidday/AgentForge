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
    reviewId: "rev-1",
    summary: "Looks good overall.",
    findings: [
      {
        id: "f1",
        severity: "important",
        type: "bug",
        file: "src/foo.ts",
        title: "Missing null check",
        details: "req.body can be undefined.",
      },
      {
        id: "f2",
        severity: "blocker",
        type: "bug",
        file: "src/foo.ts",
        title: "Hardcoded secret",
        details: "API key is hardcoded.",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function buildAgent(reviewOverrides: Partial<Review> = {}) {
  const agentRunner = {
    run: vi.fn().mockResolvedValue({
      raw: "raw reviewer transcript",
      parsed: { stage: "reviewer" as const, payload: makeReview(reviewOverrides) },
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, agentRunner, artifactRepo, logger };
}

describe("ReviewerAgent.run()", () => {
  it("returns the parsed review from the agent runner", async () => {
    const { agent } = buildAgent();

    const review = await agent.run(makePlan(), makeReport(), "diff content", makeTaskBundle(), "run-1");

    expect(review.reviewId).toBe("rev-1");
    expect(review.overallVerdict).toBe("changes_requested");
    expect(review.findings).toHaveLength(2);
  });

  it("persists a ReviewerTranscript artifact with the raw CLI output", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeReport(), "diff content", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]);
    const transcript = calls.find(
      (a: unknown) => (a as { type?: string }).type === "ReviewerTranscript",
    ) as { rawText: string; runId: string };
    expect(transcript).toBeDefined();
    expect(transcript.rawText).toBe("raw reviewer transcript");
    expect(transcript.runId).toBe("run-1");
  });

  it("persists a Review artifact whose payload matches the parsed review", async () => {
    const { agent, artifactRepo } = buildAgent();

    const review = await agent.run(
      makePlan(),
      makeReport(),
      "diff content",
      makeTaskBundle(),
      "run-1",
    );

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]);
    const reviewArtifact = calls.find(
      (a: unknown) => (a as { type?: string }).type === "Review",
    ) as { payloadJson: unknown; version: number };
    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact.version).toBe(1);
    expect(reviewArtifact.payloadJson).toEqual(review);
  });

  it("logs blocker and important finding counts separately from the total", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeReport(), "diff content", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.totalFindings).toBe(2);
    expect(payload.blockerCount).toBe(1);
    expect(payload.importantCount).toBe(1);
    expect(payload.verdict).toBe("changes_requested");
  });

  it("reports zero blockers/important findings when the review approves with only nits", async () => {
    const { agent, logger } = buildAgent({
      overallVerdict: "approved",
      findings: [
        {
          id: "f3",
          severity: "nit",
          type: "style",
          file: "src/foo.ts",
          title: "Style nit",
          details: "Minor formatting.",
        },
      ],
    });

    await agent.run(makePlan(), makeReport(), "diff content", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.blockerCount).toBe(0);
    expect(payload.importantCount).toBe(0);
    expect(payload.verdict).toBe("approved");
  });

  it("passes the task bundle's repo path as the working directory to the agent runner", async () => {
    const { agent, agentRunner } = buildAgent();
    const taskBundle = makeTaskBundle();

    await agent.run(makePlan(), makeReport(), "diff content", taskBundle, "run-1");

    const [, opts] = agentRunner.run.mock.calls[0];
    expect((opts as { workingDirectory: string }).workingDirectory).toBe(taskBundle.repo.repoPath);
  });
});
