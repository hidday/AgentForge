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

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
    summary: "Found a real bug and one nit.",
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
        title: "Unhandled error",
        details: "Error swallowed",
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
  let capturedWorkingDirectory = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        _runtime: unknown,
        opts: { prompt: string; systemPrompt: string; workingDirectory: string },
      ) => {
        capturedSystemPrompt = opts.systemPrompt;
        capturedUserPrompt = opts.prompt;
        capturedWorkingDirectory = opts.workingDirectory;
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
    getWorkingDirectory: () => capturedWorkingDirectory,
  };
}

describe("ReviewerAgent.run()", () => {
  it("logs the start of the reviewer agent run", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a b", makeTaskBundle(), "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      { runId: "run-1" },
      "Starting reviewer agent (Codex CLI)",
    );
  });

  it("renders the plan, executionReport and diff into the prompts and uses the repo path as cwd", async () => {
    const { agent, getUserPrompt, getWorkingDirectory } = buildAgent();
    const bundle = makeTaskBundle();

    await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff --git a/foo.ts b/foo.ts\n+added line",
      bundle,
      "run-1",
    );

    const prompt = getUserPrompt();
    expect(prompt).toContain("Test plan");
    expect(prompt).toContain("Implemented things.");
    expect(prompt).toContain("added line");
    expect(getWorkingDirectory()).toBe(bundle.repo.repoPath);
  });

  it("persists a ReviewerTranscript artifact with the raw CLI output", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(artifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        type: "ReviewerTranscript",
        version: 3,
        rawText: "raw reviewer transcript",
      }),
    );
  });

  it("persists a Review artifact with the parsed payload", async () => {
    const { agent, artifactRepo } = buildAgent();
    const review = makeReview();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(artifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        type: "Review",
        version: 1,
        payloadJson: expect.objectContaining({ reviewId: review.reviewId }),
        rawText: JSON.stringify(review, null, 2),
      }),
    );
  });

  it("counts blocker and important findings separately and logs them on completion", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.reviewId).toBe("rev-001");
    expect(payload?.verdict).toBe("changes_requested");
    expect(payload?.totalFindings).toBe(3);
    expect(payload?.blockerCount).toBe(1);
    expect(payload?.importantCount).toBe(1);
  });

  it("reports zero blockers and zero important findings when the review has none of those severities", async () => {
    const { agent, logger } = buildAgent(
      makeReview({
        findings: [
          {
            id: "f1",
            severity: "nit",
            type: "style",
            file: "src/foo.ts",
            title: "Nit only",
            details: "Minor style issue",
          },
        ],
        overallVerdict: "approved",
      }),
    );

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.totalFindings).toBe(1);
    expect(payload?.blockerCount).toBe(0);
    expect(payload?.importantCount).toBe(0);
    expect(payload?.verdict).toBe("approved");
  });

  it("returns the parsed review payload to the caller", async () => {
    const { agent } = buildAgent();

    const result = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff",
      makeTaskBundle(),
      "run-1",
    );

    expect(result.reviewId).toBe("rev-001");
    expect(result.findings).toHaveLength(3);
    expect(result.overallVerdict).toBe("changes_requested");
  });
});
