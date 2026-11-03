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
    scoreRationale: "Implementation looks solid.",
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
        lineHint: 12,
        title: "Missing null check",
        details: "Will throw if foo is null",
      },
      {
        id: "f2",
        severity: "important",
        type: "bug",
        file: "src/foo.ts",
        title: "Unhandled error path",
        details: "Error from fetch is swallowed",
      },
      {
        id: "f3",
        severity: "nit",
        type: "style",
        file: "src/foo.ts",
        title: "Long line",
        details: "Could be split for readability",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function buildAgent(reviewOverride?: Review) {
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
  };
}

describe("ReviewerAgent.run()", () => {
  it("renders the task bundle, plan, execution report and diff into the prompts", async () => {
    const { agent, getSystemPrompt, getUserPrompt } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/foo b/foo", makeTaskBundle(), "run-1");

    const systemPrompt = getSystemPrompt();
    const userPrompt = getUserPrompt();
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(systemPrompt).not.toContain("{{issue.title}}");
    // The user template interpolates taskBundle/plan/executionReport/diff vars.
    expect(userPrompt).toContain("Test issue");
    expect(userPrompt).toContain("Test plan");
  });

  it("persists a ReviewerTranscript artifact with the raw CLI output", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      runId: string;
      type: string;
      version: number;
      rawText: string;
    }[];
    const transcript = calls.find((a) => a.type === "ReviewerTranscript");
    expect(transcript).toBeDefined();
    expect(transcript?.runId).toBe("run-1");
    expect(transcript?.version).toBe(3);
    expect(transcript?.rawText).toBe("raw reviewer transcript");
  });

  it("persists a Review artifact (version 1) with the parsed review payload", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      type: string;
      version: number;
      payloadJson: unknown;
    }[];
    const reviewArtifact = calls.find((a) => a.type === "Review");
    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact?.version).toBe(1);
    expect((reviewArtifact?.payloadJson as Review).reviewId).toBe("rev-001");
    expect((reviewArtifact?.payloadJson as Review).findings).toHaveLength(3);
  });

  it("logs blocker and important finding counts separately from the total", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.totalFindings).toBe(3);
    expect(payload?.blockerCount).toBe(1);
    expect(payload?.importantCount).toBe(1);
    expect(payload?.verdict).toBe("changes_requested");
    expect(payload?.reviewId).toBe("rev-001");
  });

  it("reports zero blocker/important counts when the review has only nits", async () => {
    const nitOnlyReview = makeReview({
      overallVerdict: "approved",
      findings: [
        {
          id: "f1",
          severity: "nit",
          type: "style",
          file: "src/foo.ts",
          title: "Long line",
          details: "Could be split for readability",
        },
      ],
    });
    const { agent, logger } = buildAgent(nitOnlyReview);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.totalFindings).toBe(1);
    expect(payload?.blockerCount).toBe(0);
    expect(payload?.importantCount).toBe(0);
    expect(payload?.verdict).toBe("approved");
  });

  it("returns the parsed review payload from the agent runner", async () => {
    const { agent } = buildAgent();

    const result = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff",
      makeTaskBundle(),
      "run-1",
    );

    expect(result.reviewId).toBe("rev-001");
    expect(result.overallVerdict).toBe("changes_requested");
    expect(result.findings).toHaveLength(3);
  });

  it("logs a start event before calling the agent runner", async () => {
    const { agent, agentRunner, logger } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      { runId: "run-1" },
      "Starting reviewer agent (Codex CLI)",
    );
    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    expect(agentRunner.run.mock.calls[0]?.[2]).toBe("reviewer");
  });
});
