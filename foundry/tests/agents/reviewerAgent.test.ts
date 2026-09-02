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
  it("routes to the reviewer runtime with the repo working directory and agent timeout", async () => {
    const { agent, agentRunner, getWorkingDirectory } = buildReviewerAgent();
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a b", bundle, "run-1");

    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    const [runtime, , stage] = agentRunner.run.mock.calls[0]!;
    expect(runtime).toBe("codex");
    expect(stage).toBe("reviewer");
    expect(getWorkingDirectory()).toBe(bundle.repo.repoPath);
  });

  it("persists a ReviewerTranscript artifact (version 3) with the raw output", async () => {
    const { agent, artifactRepo } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]);
    const transcript = calls.find(
      (a: unknown) => (a as { type?: string }).type === "ReviewerTranscript",
    ) as { version: number; rawText: string; payloadJson: unknown };

    expect(transcript).toBeDefined();
    expect(transcript.version).toBe(3);
    expect(transcript.rawText).toBe("raw reviewer transcript");
    expect(transcript.payloadJson).toEqual({});
  });

  it("persists a Review artifact (version 1) with the parsed review as payload and JSON rawText", async () => {
    const { agent, artifactRepo } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]);
    const reviewArtifact = calls.find(
      (a: unknown) => (a as { type?: string }).type === "Review",
    ) as { version: number; payloadJson: Review; rawText: string };

    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact.version).toBe(1);
    expect(reviewArtifact.payloadJson.reviewId).toBe("rev-001");
    expect(reviewArtifact.rawText).toBe(JSON.stringify(reviewArtifact.payloadJson, null, 2));
  });

  it("returns the parsed review", async () => {
    const { agent } = buildReviewerAgent({ overallVerdict: "changes_requested" });

    const review = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff",
      makeTaskBundle(),
      "run-1",
    );

    expect(review.overallVerdict).toBe("changes_requested");
    expect(review.reviewId).toBe("rev-001");
  });

  it("counts blocker and important findings separately in the completion log", async () => {
    const { agent, logger } = buildReviewerAgent({
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "bug",
          file: "src/foo.ts",
          title: "Bug",
          details: "Something is broken",
        },
        {
          id: "f2",
          severity: "blocker",
          type: "bug",
          file: "src/bar.ts",
          title: "Another bug",
          details: "Also broken",
        },
        {
          id: "f3",
          severity: "important",
          type: "style",
          file: "src/baz.ts",
          title: "Style issue",
          details: "Not idiomatic",
        },
        {
          id: "f4",
          severity: "nit",
          type: "style",
          file: "src/qux.ts",
          title: "Nit",
          details: "Minor",
        },
      ],
    });

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.totalFindings).toBe(4);
    expect(payload?.blockerCount).toBe(2);
    expect(payload?.importantCount).toBe(1);
    expect(payload?.reviewId).toBe("rev-001");
    expect(payload?.verdict).toBe("approved");
  });

  it("logs a start event including the runId before invoking the runner", async () => {
    const { agent, logger } = buildReviewerAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-42");

    const startLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Starting reviewer agent (Codex CLI)",
    );
    expect(startLog).toBeDefined();
    expect((startLog?.[0] as Record<string, unknown>).runId).toBe("run-42");
  });

  it("renders the diff and taskBundle fields into the templates without leaving placeholders", async () => {
    const { agent, getUserPrompt } = buildReviewerAgent();
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/x b/x", bundle, "run-1");

    const prompt = getUserPrompt();
    expect(prompt).not.toContain("{{diff}}");
    expect(prompt).not.toContain("{{summary}}");
  });
});
