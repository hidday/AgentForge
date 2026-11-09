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

function makeExecutionReport(): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Solid implementation.",
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
        lineHint: 10,
        title: "Null pointer",
        details: "Will crash if foo is null",
      },
      {
        id: "f2",
        severity: "important",
        type: "bug",
        file: "src/foo.ts",
        title: "Missing error handling",
        details: "Unhandled promise rejection",
      },
      {
        id: "f3",
        severity: "nit",
        type: "style",
        file: "src/foo.ts",
        title: "Line too long",
        details: "Consider splitting",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function buildAgent(reviewOverride?: Review) {
  let capturedPrompt = "";
  let capturedSystemPrompt = "";
  let capturedOpts: Record<string, unknown> = {};

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        _runtime: unknown,
        opts: { prompt: string; systemPrompt: string; workingDirectory: string; timeoutMs: number; runId: string },
        _name: unknown,
        _schema: unknown,
      ) => {
        capturedPrompt = opts.prompt;
        capturedSystemPrompt = opts.systemPrompt;
        capturedOpts = opts;
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
    getPrompt: () => capturedPrompt,
    getSystemPrompt: () => capturedSystemPrompt,
    getOpts: () => capturedOpts,
  };
}

describe("ReviewerAgent.run()", () => {
  it("logs the start of the reviewer agent with the runId", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/x b/x", makeTaskBundle(), "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      { runId: "run-1" },
      "Starting reviewer agent (Codex CLI)",
    );
  });

  it("calls the agent runner with the rendered prompts, workingDirectory, and runId", async () => {
    const { agent, getOpts } = buildAgent();
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/x b/x", bundle, "run-42");

    const opts = getOpts();
    expect(opts.workingDirectory).toBe(bundle.repo.repoPath);
    expect(opts.runId).toBe("run-42");
    expect(typeof opts.timeoutMs).toBe("number");
  });

  it("renders the plan, executionReport, diff, and taskBundle fields into the prompt", async () => {
    const { agent, getPrompt, getSystemPrompt } = buildAgent();
    const bundle = makeTaskBundle();
    const plan = makePlan();
    const report = makeExecutionReport();

    await agent.run(plan, report, "diff --git a/src/foo.ts b/src/foo.ts\n+added line", bundle, "run-1");

    const prompt = getPrompt();
    const systemPrompt = getSystemPrompt();
    // The templates reference taskBundle/plan/executionReport/diff fields; at minimum
    // the issue id/title should flow through since both templates interpolate taskBundle.
    expect(prompt + systemPrompt).toContain("LIN-1");
  });

  it("persists a ReviewerTranscript artifact with the raw output", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(artifactRepo.create).toHaveBeenCalledWith({
      runId: "run-1",
      type: "ReviewerTranscript",
      version: 3,
      payloadJson: {},
      rawText: "raw reviewer transcript",
    });
  });

  it("persists a Review artifact with the parsed review payload", async () => {
    const review = makeReview();
    const { agent, artifactRepo } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(artifactRepo.create).toHaveBeenCalledWith({
      runId: "run-1",
      type: "Review",
      version: 1,
      payloadJson: review,
      rawText: JSON.stringify(review, null, 2),
    });
  });

  it("returns the parsed review payload", async () => {
    const review = makeReview();
    const { agent } = buildAgent(review);

    const result = await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(result).toEqual(review);
  });

  it("counts blocker and important findings correctly and logs them in the completion event", async () => {
    const review = makeReview();
    const { agent, logger } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.runId).toBe("run-1");
    expect(payload?.reviewId).toBe("rev-001");
    expect(payload?.verdict).toBe("changes_requested");
    expect(payload?.totalFindings).toBe(3);
    expect(payload?.blockerCount).toBe(1);
    expect(payload?.importantCount).toBe(1);
  });

  it("reports zero blocker/important counts and an 'approved' verdict when there are no findings", async () => {
    const cleanReview = makeReview({ findings: [], overallVerdict: "approved" });
    const { agent, logger } = buildAgent(cleanReview);

    const result = await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(result.overallVerdict).toBe("approved");
    expect(result.findings).toHaveLength(0);

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.totalFindings).toBe(0);
    expect(payload?.blockerCount).toBe(0);
    expect(payload?.importantCount).toBe(0);
    expect(payload?.verdict).toBe("approved");
  });

  it("propagates a rejected promise from the agent runner", async () => {
    const agentRunner = {
      run: vi.fn().mockRejectedValue(new Error("Codex CLI crashed")),
    };
    const artifactRepo = {
      create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

    await expect(
      agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1"),
    ).rejects.toThrow("Codex CLI crashed");

    // No artifacts should be persisted if the runner itself failed.
    expect(artifactRepo.create).not.toHaveBeenCalled();
  });

  it("propagates when the runner's output cannot be parsed into the expected shape", async () => {
    const agentRunner = {
      run: vi.fn().mockImplementation(() => {
        throw new Error("malformed CLI output: missing BEGIN_STRUCTURED_OUTPUT marker");
      }),
    };
    const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

    await expect(
      agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1"),
    ).rejects.toThrow(/malformed CLI output/);
  });
});
