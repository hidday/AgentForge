import { describe, it, expect, vi } from "vitest";
import { ReviewerAgent } from "../../src/agents/reviewerAgent.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
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
    summary: "Plan summary",
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
      tests: { status: "pass", details: "all green" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks good.",
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
    summary: "Found some issues.",
    findings: [
      {
        id: "f1",
        severity: "blocker",
        type: "bug",
        file: "src/foo.ts",
        lineHint: 10,
        title: "Null deref",
        details: "Will crash on null input",
      },
      {
        id: "f2",
        severity: "blocker",
        type: "bug",
        file: "src/bar.ts",
        title: "Race condition",
        details: "Concurrent writes not guarded",
      },
      {
        id: "f3",
        severity: "important",
        type: "logic",
        file: "src/foo.ts",
        title: "Off-by-one",
        details: "Loop bound is wrong",
      },
      {
        id: "f4",
        severity: "nit",
        type: "style",
        file: "src/foo.ts",
        title: "Naming",
        details: "Prefer camelCase",
      },
      {
        id: "f5",
        severity: "suggestion",
        type: "refactor",
        file: "src/foo.ts",
        title: "Extract helper",
        details: "Could be simplified",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function buildAgent(reviewOverride?: Review) {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";
  let capturedRuntime: unknown;
  let capturedOpts: {
    workingDirectory: string;
    timeoutMs: number;
    runId: string;
  } | null = null;

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        runtime: unknown,
        opts: {
          prompt: string;
          systemPrompt: string;
          workingDirectory: string;
          timeoutMs: number;
          runId: string;
        },
      ) => {
        capturedRuntime = runtime;
        capturedSystemPrompt = opts.systemPrompt;
        capturedUserPrompt = opts.prompt;
        capturedOpts = {
          workingDirectory: opts.workingDirectory,
          timeoutMs: opts.timeoutMs,
          runId: opts.runId,
        };
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
    create: vi.fn().mockResolvedValue({ id: "a1" }),
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
    getRuntime: () => capturedRuntime,
    getOpts: () => capturedOpts,
  };
}

describe("ReviewerAgent.run()", () => {
  it("calls agentRunner.run with rendered prompts and the correct runtime/workingDirectory/timeoutMs/runId", async () => {
    const { agent, getSystemPrompt, getUserPrompt, getRuntime, getOpts } = buildAgent();
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/foo b/foo", bundle, "run-1");

    expect(getRuntime()).toBe("codex");
    expect(getOpts()).toEqual({
      workingDirectory: "/tmp/repo",
      timeoutMs: expect.any(Number),
      runId: "run-1",
    });

    const systemPrompt = getSystemPrompt();
    const userPrompt = getUserPrompt();
    expect(typeof systemPrompt).toBe("string");
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(typeof userPrompt).toBe("string");
    expect(userPrompt.length).toBeGreaterThan(0);
  });

  it("writes a ReviewerTranscript artifact (version 3) with the raw text", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    }[];

    const transcript = calls.find((a) => a.type === "ReviewerTranscript");
    expect(transcript).toBeDefined();
    expect(transcript?.version).toBe(3);
    expect(transcript?.runId).toBe("run-1");
    expect(transcript?.rawText).toBe("raw reviewer transcript");
    expect(transcript?.payloadJson).toEqual({});
  });

  it("writes a Review artifact (version 1) with the parsed payload", async () => {
    const review = makeReview();
    const { agent, artifactRepo } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    }[];

    const reviewArtifact = calls.find((a) => a.type === "Review");
    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact?.version).toBe(1);
    expect(reviewArtifact?.payloadJson).toEqual(review);
    expect(reviewArtifact?.rawText).toBe(JSON.stringify(review, null, 2));
  });

  it("returns the parsed review", async () => {
    const review = makeReview();
    const { agent } = buildAgent(review);

    const result = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff",
      makeTaskBundle(),
      "run-1",
    );

    expect(result).toEqual(review);
  });

  it("logs the final completion message with correct blockerCount/importantCount derived from findings", async () => {
    const review = makeReview();
    const { agent, logger } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.runId).toBe("run-1");
    expect(payload?.reviewId).toBe("rev-001");
    expect(payload?.verdict).toBe("changes_requested");
    expect(payload?.totalFindings).toBe(5);
    // 2 blockers, 1 important, 1 nit, 1 suggestion in the fixture
    expect(payload?.blockerCount).toBe(2);
    expect(payload?.importantCount).toBe(1);
  });
});
