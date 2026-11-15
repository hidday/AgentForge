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

function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
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

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "review-1",
    summary: "Looks fine overall.",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function buildAgent(review: Review = makeReview()) {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";
  let capturedRunOpts: unknown;

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        _runtime: unknown,
        opts: { prompt: string; systemPrompt: string },
      ) => {
        capturedSystemPrompt = opts.systemPrompt;
        capturedUserPrompt = opts.prompt;
        capturedRunOpts = opts;
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
  it("renders the reviewer system/user prompts from the plan, execution report, and diff", async () => {
    const { agent, getSystemPrompt, getUserPrompt } = buildAgent();

    await agent.run(makePlan(), makeReport(), "diff --git a/x b/x", makeTaskBundle(), "run-1");

    expect(getSystemPrompt().length).toBeGreaterThan(0);
    expect(getUserPrompt().length).toBeGreaterThan(0);
  });

  it("invokes the agent runner with the codex runtime and the reviewer stage/schema", async () => {
    const { agent, agentRunner } = buildAgent();

    await agent.run(makePlan(), makeReport(), "some diff", makeTaskBundle(), "run-1");

    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    const [runtime, , stage] = agentRunner.run.mock.calls[0] as [string, unknown, string];
    expect(runtime).toBe("codex");
    expect(stage).toBe("reviewer");
  });

  it("persists a ReviewerTranscript artifact with the raw transcript", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeReport(), "some diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as Array<{
      type?: string;
      rawText?: string;
      version?: number;
    }>;
    const transcript = calls.find((a) => a.type === "ReviewerTranscript");
    expect(transcript).toBeDefined();
    expect(transcript?.rawText).toBe("raw reviewer transcript");
    expect(transcript?.version).toBe(3);
  });

  it("persists a Review artifact with the parsed review payload", async () => {
    const review = makeReview({ reviewId: "review-42", overallVerdict: "changes_requested" });
    const { agent, artifactRepo } = buildAgent(review);

    await agent.run(makePlan(), makeReport(), "some diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as Array<{
      type?: string;
      payloadJson?: unknown;
      version?: number;
    }>;
    const reviewArtifact = calls.find((a) => a.type === "Review");
    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact?.version).toBe(1);
    expect((reviewArtifact?.payloadJson as Review).reviewId).toBe("review-42");
    expect((reviewArtifact?.payloadJson as Review).overallVerdict).toBe("changes_requested");
  });

  it("logs blocker and important finding counts separately from other severities", async () => {
    const review = makeReview({
      reviewId: "review-7",
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t1", details: "d1" },
        { id: "f2", severity: "blocker", type: "bug", file: "b.ts", title: "t2", details: "d2" },
        {
          id: "f3",
          severity: "important",
          type: "bug",
          file: "c.ts",
          title: "t3",
          details: "d3",
        },
        { id: "f4", severity: "nit", type: "style", file: "d.ts", title: "t4", details: "d4" },
      ],
    });
    const { agent, logger } = buildAgent(review);

    await agent.run(makePlan(), makeReport(), "some diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.reviewId).toBe("review-7");
    expect(payload.verdict).toBe("changes_requested");
    expect(payload.totalFindings).toBe(4);
    expect(payload.blockerCount).toBe(2);
    expect(payload.importantCount).toBe(1);
  });

  it("returns the parsed review unchanged", async () => {
    const review = makeReview({ summary: "Custom summary" });
    const { agent } = buildAgent(review);

    const result = await agent.run(makePlan(), makeReport(), "some diff", makeTaskBundle(), "run-1");

    expect(result).toEqual(review);
  });

  it("propagates an error from the agent runner without creating any artifacts", async () => {
    const agentRunner = {
      run: vi.fn().mockRejectedValue(new Error("runner exploded")),
    };
    const artifactRepo = {
      create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
      findByRunId: vi.fn(),
      findLatestByType: vi.fn(),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

    await expect(
      agent.run(makePlan(), makeReport(), "some diff", makeTaskBundle(), "run-1"),
    ).rejects.toThrow("runner exploded");

    expect(artifactRepo.create).not.toHaveBeenCalled();
  });
});
