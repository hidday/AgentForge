import { describe, it, expect, vi } from "vitest";
import { ReviewerAgent } from "../../src/agents/reviewerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
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
    ...overrides,
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
    summary: "Implemented the feature",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.85,
    scoreRationale: "Solid implementation",
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
    summary: "Looks mostly good.",
    findings: [
      {
        id: "f1",
        severity: "blocker",
        type: "bug",
        file: "src/foo.ts",
        title: "Crash on null input",
        details: "Will throw",
      },
      {
        id: "f2",
        severity: "important",
        type: "bug",
        file: "src/foo.ts",
        title: "Missing validation",
        details: "Should validate input",
      },
      {
        id: "f3",
        severity: "nit",
        type: "style",
        file: "src/foo.ts",
        title: "Naming",
        details: "Could be clearer",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function buildAgent(reviewOverride?: Review) {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";
  let capturedRunOpts: { workingDirectory: string; runId?: string } | undefined;

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        _runtime: unknown,
        opts: { prompt: string; systemPrompt: string; workingDirectory: string; runId?: string },
      ) => {
        capturedSystemPrompt = opts.systemPrompt;
        capturedUserPrompt = opts.prompt;
        capturedRunOpts = opts;
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
    getRunOpts: () => capturedRunOpts,
  };
}

describe("ReviewerAgent.run()", () => {
  it("calls the agent runner with the codex runtime and the task's working directory", async () => {
    const { agent, agentRunner, getRunOpts } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/x b/x", makeTaskBundle(), "run-1");

    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    expect(agentRunner.run.mock.calls[0][0]).toBe("codex");
    expect(getRunOpts()?.workingDirectory).toBe("/tmp/repo");
    expect(getRunOpts()?.runId).toBe("run-1");
  });

  it("renders the diff and plan summary into the prompts", async () => {
    const { agent, getUserPrompt } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/x b/x new content", makeTaskBundle(), "run-1");

    expect(getUserPrompt()).toContain("diff --git a/x b/x new content");
  });

  it("logs the start of the reviewer agent with the run id", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-42");

    expect(logger.info).toHaveBeenCalledWith(
      { runId: "run-42" },
      "Starting reviewer agent (Codex CLI)",
    );
  });

  it("persists a ReviewerTranscript artifact with the raw model output", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      type: string;
      rawText?: string;
    }[];
    const transcript = calls.find((a) => a.type === "ReviewerTranscript");
    expect(transcript).toBeDefined();
    expect(transcript?.rawText).toBe("raw reviewer transcript");
  });

  it("persists a Review artifact with the parsed payload", async () => {
    const review = makeReview({ reviewId: "rev-999" });
    const { agent, artifactRepo } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      type: string;
      payloadJson: unknown;
    }[];
    const reviewArtifact = calls.find((a) => a.type === "Review");
    expect(reviewArtifact).toBeDefined();
    expect((reviewArtifact?.payloadJson as Review).reviewId).toBe("rev-999");
  });

  it("returns the parsed review payload", async () => {
    const review = makeReview({ overallVerdict: "approved", findings: [] });
    const { agent } = buildAgent(review);

    const result = await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(result.overallVerdict).toBe("approved");
    expect(result.findings).toEqual([]);
  });

  it("logs completion with correct blocker and important finding counts", async () => {
    const { agent, logger } = buildAgent();

    const result = await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(result.findings).toHaveLength(3);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        reviewId: "rev-001",
        verdict: "changes_requested",
        totalFindings: 3,
        blockerCount: 1,
        importantCount: 1,
      }),
      "Review completed",
    );
  });

  it("propagates a rejection when the agent runner fails (e.g. malformed model output)", async () => {
    const agentRunner = {
      run: vi.fn().mockRejectedValue(new Error("failed to parse structured output")),
    };
    const artifactRepo = { create: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

    await expect(
      agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1"),
    ).rejects.toThrow("failed to parse structured output");
    expect(artifactRepo.create).not.toHaveBeenCalled();
  });

  it("reports zero blockers and zero important findings when there are none", async () => {
    const { agent, logger } = buildAgent(
      makeReview({
        findings: [
          {
            id: "f1",
            severity: "nit",
            type: "style",
            file: "src/foo.ts",
            title: "Nit",
            details: "minor",
          },
        ],
        overallVerdict: "approved",
      }),
    );

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ blockerCount: 0, importantCount: 0, totalFindings: 1 }),
      "Review completed",
    );
  });
});
