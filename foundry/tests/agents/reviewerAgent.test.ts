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
    scoreRationale: "Looks solid.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
    summary: "Looks good overall.",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function buildReviewerAgent(reviewOverrides: Partial<Review> = {}) {
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
            payload: makeReview(reviewOverrides),
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
    getWorkingDirectory: () => capturedWorkingDirectory,
  };
}

describe("ReviewerAgent.run()", () => {
  it("runs the reviewer via the codex runtime with the repo path as the working directory", async () => {
    const { agent, agentRunner, getWorkingDirectory } = buildReviewerAgent();
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff text", bundle, "run-1");

    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    const [runtime] = agentRunner.run.mock.calls[0] as [string];
    expect(runtime).toBe("codex");
    expect(getWorkingDirectory()).toBe("/tmp");
  });

  it("renders the diff and execution report summary into the user prompt", async () => {
    const { agent, getUserPrompt } = buildReviewerAgent();
    const bundle = makeTaskBundle();
    const report = makeExecutionReport({ summary: "A very specific summary marker" });

    await agent.run(makePlan(), report, "+added line\n-removed line", bundle, "run-1");

    const prompt = getUserPrompt();
    expect(prompt).toContain("+added line");
    expect(prompt).toContain("A very specific summary marker");
  });

  it("persists a ReviewerTranscript artifact with the raw CLI output", async () => {
    const { agent, artifactRepo } = buildReviewerAgent();
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff", bundle, "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]);
    const transcriptArtifact = calls.find(
      (a: unknown) => (a as { type?: string }).type === "ReviewerTranscript",
    ) as { rawText: string; version: number };
    expect(transcriptArtifact).toBeDefined();
    expect(transcriptArtifact.rawText).toBe("raw reviewer transcript");
    expect(transcriptArtifact.version).toBe(3);
  });

  it("persists a Review artifact with the parsed review payload", async () => {
    const { agent, artifactRepo } = buildReviewerAgent({ summary: "Distinctive review summary" });
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff", bundle, "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]);
    const reviewArtifact = calls.find(
      (a: unknown) => (a as { type?: string }).type === "Review",
    ) as { version: number; payloadJson: { summary: string }; rawText: string };
    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact.version).toBe(1);
    expect(reviewArtifact.payloadJson.summary).toBe("Distinctive review summary");
    expect(reviewArtifact.rawText).toContain("Distinctive review summary");
  });

  it("returns the parsed review unchanged", async () => {
    const { agent } = buildReviewerAgent({ overallVerdict: "changes_requested" });
    const bundle = makeTaskBundle();

    const review = await agent.run(makePlan(), makeExecutionReport(), "diff", bundle, "run-1");

    expect(review.overallVerdict).toBe("changes_requested");
    expect(review.reviewId).toBe("rev-001");
  });

  it("logs blocker and important finding counts separately from the total", async () => {
    const { agent, logger } = buildReviewerAgent({
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
      overallVerdict: "changes_requested",
    });
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff", bundle, "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        reviewId: "rev-001",
        verdict: "changes_requested",
        totalFindings: 4,
        blockerCount: 2,
        importantCount: 1,
      }),
      "Review completed",
    );
  });

  it("logs zero blocker/important counts when there are no findings", async () => {
    const { agent, logger } = buildReviewerAgent({ findings: [] });
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff", bundle, "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalFindings: 0, blockerCount: 0, importantCount: 0 }),
      "Review completed",
    );
  });
});
