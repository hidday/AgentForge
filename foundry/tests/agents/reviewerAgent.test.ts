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
    score: 0.8,
    scoreRationale: "Looks solid.",
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
    summary: "Found a couple of issues",
    findings: [
      {
        id: "f1",
        severity: "blocker",
        type: "bug",
        file: "src/foo.ts",
        title: "Null pointer",
        details: "Will crash on null input",
      },
      {
        id: "f2",
        severity: "important",
        type: "bug",
        file: "src/foo.ts",
        title: "Missing error handling",
        details: "Unhandled rejection",
      },
      {
        id: "f3",
        severity: "nit",
        type: "style",
        file: "src/foo.ts",
        title: "Naming",
        details: "Prefer camelCase",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function buildReviewerAgent(reviewOverride?: Review) {
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
  it("builds prompts from the plan, executionReport, diff, and taskBundle, and runs on the reviewer stage", async () => {
    const { agent, agentRunner, getWorkingDirectory } = buildReviewerAgent();
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/foo.ts\n+line", bundle, "run-1");

    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    const [runtime, opts, name] = agentRunner.run.mock.calls[0] as [unknown, unknown, unknown];
    expect(runtime).toBe("codex");
    expect(name).toBe("reviewer");
    expect(getWorkingDirectory()).toBe("/tmp/repo");
    expect((opts as { runId: string }).runId).toBe("run-1");
  });

  it("writes a ReviewerTranscript artifact with the raw output and a Review artifact with the parsed payload", async () => {
    const review = makeReview();
    const { agent, artifactRepo } = buildReviewerAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    }[];

    const transcript = calls.find((a) => a.type === "ReviewerTranscript");
    expect(transcript).toBeDefined();
    expect(transcript?.version).toBe(3);
    expect(transcript?.rawText).toBe("raw reviewer transcript");

    const reviewArtifact = calls.find((a) => a.type === "Review");
    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact?.version).toBe(1);
    expect((reviewArtifact?.payloadJson as Review).reviewId).toBe("rev-001");
    expect(JSON.parse(reviewArtifact?.rawText ?? "{}")).toEqual(review);
  });

  it("returns the parsed review payload", async () => {
    const { agent } = buildReviewerAgent();

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

  it("logs the blocker and important finding counts separately from the total", async () => {
    const { agent, logger } = buildReviewerAgent();

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
  });

  it("logs zero blocker/important counts when the review has only nits", async () => {
    const review = makeReview({
      findings: [
        {
          id: "f1",
          severity: "nit",
          type: "style",
          file: "src/foo.ts",
          title: "Naming",
          details: "Prefer camelCase",
        },
      ],
      overallVerdict: "approved",
    });
    const { agent, logger } = buildReviewerAgent(review);

    const result = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff",
      makeTaskBundle(),
      "run-1",
    );

    expect(result.overallVerdict).toBe("approved");
    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.blockerCount).toBe(0);
    expect(payload?.importantCount).toBe(0);
    expect(payload?.totalFindings).toBe(1);
  });
});
