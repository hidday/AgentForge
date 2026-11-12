import { describe, it, expect, vi } from "vitest";
import { ReviewerAgent } from "../../src/agents/reviewerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

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

function makeReviewPayload(overrides: Partial<ReturnType<typeof baseReviewPayload>> = {}) {
  return { ...baseReviewPayload(), ...overrides };
}

function baseReviewPayload() {
  return {
    reviewId: "rev-001",
    summary: "One real bug, one nit.",
    findings: [
      {
        id: "f1",
        severity: "blocker" as const,
        type: "bug",
        file: "src/foo.ts",
        lineHint: 10,
        title: "Null pointer",
        details: "Will throw at runtime",
      },
      {
        id: "f2",
        severity: "important" as const,
        type: "bug",
        file: "src/foo.ts",
        title: "Missing error handling",
        details: "Swallows the error silently",
      },
      {
        id: "f3",
        severity: "nit" as const,
        type: "style",
        file: "src/foo.ts",
        title: "Long line",
        details: "Could be split",
      },
    ],
    overallVerdict: "changes_requested" as const,
  };
}

function buildReviewerAgent(reviewOverrides?: Partial<ReturnType<typeof baseReviewPayload>>) {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (_runtime: unknown, opts: { prompt: string; systemPrompt: string }) => {
        capturedSystemPrompt = opts.systemPrompt;
        capturedUserPrompt = opts.prompt;
        return {
          raw: "raw reviewer transcript",
          parsed: {
            stage: "reviewer" as const,
            payload: makeReviewPayload(reviewOverrides),
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
  it("renders the plan, execution report and diff into the prompts", async () => {
    const { agent, getUserPrompt } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/foo b/foo", makeTaskBundle(), "run-1");

    const prompt = getUserPrompt();
    expect(prompt).toContain("Test plan");
    expect(prompt).toContain("Implemented things.");
    expect(prompt).toContain("diff --git a/foo b/foo");
    expect(prompt).toContain("test-repo");
  });

  it("persists a ReviewerTranscript artifact (version 3) with the raw LLM output", async () => {
    const { agent, artifactRepo } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

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

  it("persists a Review artifact (version 1) with the parsed payload", async () => {
    const { agent, artifactRepo } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    }[];
    const reviewArtifact = calls.find((a) => a.type === "Review");
    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact?.version).toBe(1);
    expect((reviewArtifact?.payloadJson as { reviewId: string }).reviewId).toBe("rev-001");
    expect(reviewArtifact?.rawText).toBe(JSON.stringify(baseReviewPayload(), null, 2));
  });

  it("counts blocker and important findings correctly in the completion log", async () => {
    const { agent, logger } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.blockerCount).toBe(1);
    expect(payload?.importantCount).toBe(1);
    expect(payload?.totalFindings).toBe(3);
    expect(payload?.verdict).toBe("changes_requested");
    expect(payload?.reviewId).toBe("rev-001");
  });

  it("returns the parsed review payload including all findings", async () => {
    const { agent } = buildReviewerAgent();

    const review = await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(review.reviewId).toBe("rev-001");
    expect(review.findings).toHaveLength(3);
    expect(review.overallVerdict).toBe("changes_requested");
  });

  it("reports zero blockers/important findings when the review approves with no findings", async () => {
    const { agent, logger } = buildReviewerAgent({
      findings: [],
      overallVerdict: "approved",
    });

    const review = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff",
      makeTaskBundle(),
      "run-1",
    );

    expect(review.findings).toHaveLength(0);
    expect(review.overallVerdict).toBe("approved");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.blockerCount).toBe(0);
    expect(payload?.importantCount).toBe(0);
    expect(payload?.totalFindings).toBe(0);
  });

  it("propagates the error and persists no artifacts when the LLM call rejects (e.g. invalid/unparseable structured output)", async () => {
    const agentRunner = {
      run: vi.fn().mockRejectedValue(new Error("Structured output failed schema validation")),
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

    await expect(
      agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1"),
    ).rejects.toThrow("Structured output failed schema validation");

    expect(artifactRepo.create).not.toHaveBeenCalled();
  });

  it("logs the start of the reviewer agent with the runId before calling the LLM", async () => {
    const { agent, logger } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      { runId: "run-1" },
      "Starting reviewer agent (Codex CLI)",
    );
  });
});
