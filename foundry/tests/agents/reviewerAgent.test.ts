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
    summary: "Implemented feature",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Good implementation",
  };
}

function makeReviewPayload(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Looks good overall",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function buildReviewerAgent(reviewPayload: Review) {
  let capturedPrompt = "";
  let capturedSystemPrompt = "";
  let capturedOpts: Record<string, unknown> = {};

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        _runtime: unknown,
        opts: { prompt: string; systemPrompt: string },
      ) => {
        capturedPrompt = opts.prompt;
        capturedSystemPrompt = opts.systemPrompt;
        capturedOpts = opts as unknown as Record<string, unknown>;
        return {
          raw: "raw transcript text",
          parsed: {
            payload: reviewPayload,
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
    getPrompt: () => capturedPrompt,
    getSystemPrompt: () => capturedSystemPrompt,
    getOpts: () => capturedOpts,
  };
}

describe("ReviewerAgent.run()", () => {
  it("renders the prompt with plan, executionReport and diff, and calls agentRunner with codex runtime", async () => {
    const { agent, agentRunner, getOpts } = buildReviewerAgent(makeReviewPayload());
    const bundle = makeTaskBundle();
    const plan = makePlan();
    const execReport = makeExecutionReport();

    await agent.run(plan, execReport, "diff --git a/foo.ts b/foo.ts", bundle, "run-1");

    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    const [runtime, opts, name] = agentRunner.run.mock.calls[0] as [
      string,
      Record<string, unknown>,
      string,
    ];
    expect(runtime).toBe("codex");
    expect(name).toBe("reviewer");
    expect(opts.workingDirectory).toBe("/tmp");
    expect(opts.runId).toBe("run-1");
    expect(getOpts().prompt).toBeTruthy();
  });

  it("persists a ReviewerTranscript artifact with the raw output text", async () => {
    const { agent, artifactRepo } = buildReviewerAgent(makeReviewPayload());
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff", bundle, "run-1");

    expect(artifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        type: "ReviewerTranscript",
        version: 3,
        rawText: "raw transcript text",
      }),
    );
  });

  it("persists a Review artifact with the parsed review payload", async () => {
    const reviewPayload = makeReviewPayload({ summary: "All good", overallVerdict: "approved" });
    const { agent, artifactRepo } = buildReviewerAgent(reviewPayload);
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff", bundle, "run-1");

    expect(artifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        type: "Review",
        version: 1,
        payloadJson: reviewPayload,
        rawText: JSON.stringify(reviewPayload, null, 2),
      }),
    );
  });

  it("returns the parsed review payload to the caller", async () => {
    const reviewPayload = makeReviewPayload({ reviewId: "rev-42" });
    const { agent } = buildReviewerAgent(reviewPayload);
    const bundle = makeTaskBundle();

    const result = await agent.run(makePlan(), makeExecutionReport(), "diff", bundle, "run-1");

    expect(result).toEqual(reviewPayload);
  });

  it("counts blocker and important findings correctly and logs them", async () => {
    const reviewPayload = makeReviewPayload({
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "bug",
          file: "src/foo.ts",
          title: "Bug A",
          details: "Details A",
        },
        {
          id: "f2",
          severity: "blocker",
          type: "bug",
          file: "src/bar.ts",
          title: "Bug B",
          details: "Details B",
        },
        {
          id: "f3",
          severity: "important",
          type: "style",
          file: "src/baz.ts",
          title: "Style issue",
          details: "Details C",
        },
        {
          id: "f4",
          severity: "nit",
          type: "style",
          file: "src/qux.ts",
          title: "Nit",
          details: "Details D",
        },
      ],
    });
    const { agent, logger } = buildReviewerAgent(reviewPayload);
    const bundle = makeTaskBundle();

    const result = await agent.run(makePlan(), makeExecutionReport(), "diff", bundle, "run-1");

    expect(result.findings).toHaveLength(4);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        reviewId: "rev-1",
        verdict: "changes_requested",
        totalFindings: 4,
        blockerCount: 2,
        importantCount: 1,
      }),
      "Review completed",
    );
  });

  it("reports zero blocker/important counts when there are no findings", async () => {
    const { agent, logger } = buildReviewerAgent(makeReviewPayload({ findings: [] }));
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff", bundle, "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ blockerCount: 0, importantCount: 0, totalFindings: 0 }),
      "Review completed",
    );
  });

  it("propagates an error when the agent runner rejects", async () => {
    const agentRunner = { run: vi.fn().mockRejectedValue(new Error("runner exploded")) };
    const artifactRepo = { create: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

    await expect(
      agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1"),
    ).rejects.toThrow("runner exploded");

    expect(artifactRepo.create).not.toHaveBeenCalled();
  });
});
