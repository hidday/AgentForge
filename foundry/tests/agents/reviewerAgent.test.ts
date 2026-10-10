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
    scoreRationale: "Looks solid.",
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
    summary: "Mixed findings.",
    findings: [],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function buildAgent(review: Review) {
  const agentRunner = {
    run: vi.fn().mockResolvedValue({
      raw: "raw reviewer transcript",
      parsed: {
        stage: "reviewer" as const,
        payload: review,
      },
      success: true,
      stage: "reviewer" as const,
      durationMs: 10,
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "a1" }),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, agentRunner, artifactRepo, logger };
}

describe("ReviewerAgent.run()", () => {
  it("persists a ReviewerTranscript artifact with the raw CLI output", async () => {
    const review = makeReview();
    const { agent, artifactRepo } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff text", makeTaskBundle(), "run-1");

    expect(artifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        type: "ReviewerTranscript",
        version: 3,
        payloadJson: {},
        rawText: "raw reviewer transcript",
      }),
    );
  });

  it("persists a Review artifact matching the agent output's payload", async () => {
    const review = makeReview({
      reviewId: "rev-xyz",
      summary: "Overall fine",
      overallVerdict: "approved",
      findings: [],
    });
    const { agent, artifactRepo } = buildAgent(review);

    const result = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff text",
      makeTaskBundle(),
      "run-1",
    );

    expect(artifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        type: "Review",
        version: 1,
        payloadJson: review,
        rawText: JSON.stringify(review, null, 2),
      }),
    );
    expect(result).toEqual(review);
  });

  it("logs blockerCount and importantCount derived from a mix of finding severities", async () => {
    const review = makeReview({
      reviewId: "rev-mix",
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "bug",
          file: "src/a.ts",
          title: "Blocker one",
          details: "details",
        },
        {
          id: "f2",
          severity: "blocker",
          type: "bug",
          file: "src/b.ts",
          title: "Blocker two",
          details: "details",
        },
        {
          id: "f3",
          severity: "important",
          type: "bug",
          file: "src/c.ts",
          title: "Important one",
          details: "details",
        },
        {
          id: "f4",
          severity: "suggestion",
          type: "style",
          file: "src/d.ts",
          title: "Suggestion",
          details: "details",
        },
        {
          id: "f5",
          severity: "nit",
          type: "style",
          file: "src/e.ts",
          title: "Nit",
          details: "details",
        },
      ],
    });
    const { agent, logger } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff text", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.reviewId).toBe("rev-mix");
    expect(payload?.verdict).toBe("changes_requested");
    expect(payload?.totalFindings).toBe(5);
    expect(payload?.blockerCount).toBe(2);
    expect(payload?.importantCount).toBe(1);
  });

  it("calls agentRunner.run with the rendered prompts, repo path, and runId", async () => {
    const review = makeReview();
    const { agent, agentRunner } = buildAgent(review);
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff text", bundle, "run-42");

    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    const [runtime, opts, name] = agentRunner.run.mock.calls[0] as [
      unknown,
      { prompt: string; systemPrompt: string; workingDirectory: string; runId: string },
      string,
    ];
    expect(opts.workingDirectory).toBe(bundle.repo.repoPath);
    expect(opts.runId).toBe("run-42");
    expect(opts.prompt).toContain("LIN-1");
    expect(opts.prompt).toContain("diff text");
    expect(typeof opts.systemPrompt).toBe("string");
    expect(name).toBe("reviewer");
    expect(runtime).toBeDefined();
  });

  it("logs the starting message with runId before calling the agent runner", async () => {
    const review = makeReview();
    const { agent, logger } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff text", makeTaskBundle(), "run-7");

    expect(logger.info).toHaveBeenCalledWith(
      { runId: "run-7" },
      "Starting reviewer agent (Codex CLI)",
    );
  });
});
