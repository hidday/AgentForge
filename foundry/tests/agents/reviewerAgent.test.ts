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
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function buildAgent(review: Review = makeReview()) {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";
  let capturedRunOpts: { workingDirectory: string; timeoutMs: number; runId: string } | undefined;

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        _runtime: unknown,
        opts: {
          prompt: string;
          systemPrompt: string;
          workingDirectory: string;
          timeoutMs: number;
          runId: string;
        },
      ) => {
        capturedSystemPrompt = opts.systemPrompt;
        capturedUserPrompt = opts.prompt;
        capturedRunOpts = {
          workingDirectory: opts.workingDirectory,
          timeoutMs: opts.timeoutMs,
          runId: opts.runId,
        };
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
  it("logs the start of the reviewer agent run", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff content", makeTaskBundle(), "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      { runId: "run-1" },
      "Starting reviewer agent (Codex CLI)",
    );
  });

  it("renders the prompts with plan, executionReport, diff and taskBundle context, and runs on codex", async () => {
    const { agent, agentRunner, getSystemPrompt, getUserPrompt, getRunOpts } = buildAgent();
    const bundle = makeTaskBundle();
    const plan = makePlan();
    const report = makeExecutionReport();

    await agent.run(plan, report, "diff --git a/foo b/foo", bundle, "run-1");

    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    const [runtime, , stage, schema] = agentRunner.run.mock.calls[0] as unknown[];
    expect(runtime).toBe("codex");
    expect(stage).toBe("reviewer");
    expect(schema).toBeDefined();

    expect(getUserPrompt().length).toBeGreaterThan(0);
    expect(getSystemPrompt().length).toBeGreaterThan(0);
    expect(getRunOpts()).toEqual({
      workingDirectory: bundle.repo.repoPath,
      timeoutMs: expect.any(Number),
      runId: "run-1",
    });
  });

  it("persists a ReviewerTranscript artifact (version 3) with the raw output", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const transcriptCall = artifactRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === "ReviewerTranscript",
    );
    expect(transcriptCall).toBeDefined();
    const params = transcriptCall![0] as {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    };
    expect(params.runId).toBe("run-1");
    expect(params.version).toBe(3);
    expect(params.payloadJson).toEqual({});
    expect(params.rawText).toBe("raw reviewer transcript");
  });

  it("persists a Review artifact (version 1) with the parsed review payload", async () => {
    const review = makeReview({ overallVerdict: "changes_requested" });
    const { agent, artifactRepo } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const reviewCall = artifactRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === "Review",
    );
    expect(reviewCall).toBeDefined();
    const params = reviewCall![0] as {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    };
    expect(params.runId).toBe("run-1");
    expect(params.version).toBe(1);
    expect(params.payloadJson).toEqual(review);
    expect(params.rawText).toBe(JSON.stringify(review, null, 2));
  });

  it("creates ReviewerTranscript before Review (transcript persisted first)", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const types = artifactRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { type: string }).type,
    );
    expect(types.indexOf("ReviewerTranscript")).toBeLessThan(types.indexOf("Review"));
  });

  it("returns the parsed review", async () => {
    const review = makeReview({ summary: "All good here" });
    const { agent } = buildAgent(review);

    const result = await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(result).toEqual(review);
  });

  describe("blocker/important finding-count logging", () => {
    it("logs zero blockerCount and importantCount when there are no findings", async () => {
      const review = makeReview({ findings: [] });
      const { agent, logger } = buildAgent(review);

      await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

      const completionLog = logger.info.mock.calls.find(
        (c: unknown[]) => c[1] === "Review completed",
      );
      expect(completionLog).toBeDefined();
      const payload = completionLog?.[0] as Record<string, unknown>;
      expect(payload.blockerCount).toBe(0);
      expect(payload.importantCount).toBe(0);
      expect(payload.totalFindings).toBe(0);
    });

    it("correctly counts blocker and important findings separately from other severities", async () => {
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "bug",
            file: "src/a.ts",
            title: "Blocker 1",
            details: "d",
          },
          {
            id: "f2",
            severity: "blocker",
            type: "bug",
            file: "src/b.ts",
            title: "Blocker 2",
            details: "d",
          },
          {
            id: "f3",
            severity: "important",
            type: "bug",
            file: "src/c.ts",
            title: "Important 1",
            details: "d",
          },
          {
            id: "f4",
            severity: "suggestion",
            type: "style",
            file: "src/d.ts",
            title: "Suggestion",
            details: "d",
          },
          {
            id: "f5",
            severity: "nit",
            type: "style",
            file: "src/e.ts",
            title: "Nit",
            details: "d",
          },
        ],
      });
      const { agent, logger } = buildAgent(review);

      await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

      const completionLog = logger.info.mock.calls.find(
        (c: unknown[]) => c[1] === "Review completed",
      );
      expect(completionLog).toBeDefined();
      const payload = completionLog?.[0] as Record<string, unknown>;
      expect(payload.blockerCount).toBe(2);
      expect(payload.importantCount).toBe(1);
      expect(payload.totalFindings).toBe(5);
      expect(payload.reviewId).toBe("rev-001");
      expect(payload.verdict).toBe("changes_requested");
      expect(payload.runId).toBe("run-1");
    });
  });
});
