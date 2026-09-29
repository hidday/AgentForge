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
      repoPath: "/tmp/repo-path",
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
    planVersion: 2,
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
    reviewId: "rev-001",
    summary: "Found one important issue and one nit.",
    findings: [
      {
        id: "f1",
        severity: "blocker",
        type: "bug",
        file: "src/foo.ts",
        lineHint: 12,
        title: "Null pointer risk",
        details: "foo can be null here",
      },
      {
        id: "f2",
        severity: "important",
        type: "test-gap",
        file: "src/foo.ts",
        title: "Missing edge case test",
        details: "No test for empty input",
      },
      {
        id: "f3",
        severity: "nit",
        type: "style",
        file: "src/foo.ts",
        title: "Long line",
        details: "Consider splitting",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function buildAgent(reviewOverride?: Review, runImpl?: () => Promise<unknown>) {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";
  let capturedInput: Record<string, unknown> = {};

  const agentRunner = {
    run: vi.fn().mockImplementation(
      runImpl ??
        (async (
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
          capturedInput = opts as unknown as Record<string, unknown>;
          return {
            raw: "raw reviewer transcript",
            parsed: {
              stage: "reviewer" as const,
              payload: reviewOverride ?? makeReview(),
            },
          };
        }),
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
    getInput: () => capturedInput,
  };
}

describe("ReviewerAgent.run()", () => {
  it("builds the prompt bundle from the plan, execution report, diff, and task bundle and routes it to the reviewer runner", async () => {
    const { agent, agentRunner, getSystemPrompt, getUserPrompt, getInput } = buildAgent();
    const plan = makePlan();
    const report = makeReport();
    const taskBundle = makeTaskBundle();
    const diff = "diff --git a/src/foo.ts b/src/foo.ts\n+added line";

    await agent.run(plan, report, diff, taskBundle, "run-1");

    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    const [runtime, , stageName, schema] = agentRunner.run.mock.calls[0];
    expect(runtime).toBe("codex");
    expect(stageName).toBe("reviewer");
    expect(schema).toBeDefined();

    const input = getInput();
    expect(input.workingDirectory).toBe("/tmp/repo-path");
    expect(input.runId).toBe("run-1");

    const systemPrompt = getSystemPrompt();
    expect(systemPrompt).toContain("senior software engineer acting as a code reviewer");
    expect(systemPrompt).toContain("BEGIN_STRUCTURED_OUTPUT");

    const userPrompt = getUserPrompt();
    expect(userPrompt).toContain("LIN-1");
    expect(userPrompt).toContain("Test issue");
    expect(userPrompt).toContain("v2");
    expect(userPrompt).toContain("Test plan");
    expect(userPrompt).toContain("Implemented things.");
    expect(userPrompt).toContain("pass");
    expect(userPrompt).toContain(diff);
    expect(userPrompt).not.toContain("{{diff}}");
    expect(userPrompt).not.toContain("{{plan.summary}}");
  });

  it("persists a ReviewerTranscript artifact (version 3) with the runner's raw output", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeReport(), "some diff", makeTaskBundle(), "run-1");

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

  it("persists a Review artifact (version 1) with the parsed review payload", async () => {
    const review = makeReview();
    const { agent, artifactRepo } = buildAgent(review);

    await agent.run(makePlan(), makeReport(), "some diff", makeTaskBundle(), "run-1");

    expect(artifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        type: "Review",
        version: 1,
        payloadJson: review,
        rawText: JSON.stringify(review, null, 2),
      }),
    );
  });

  it("parses the runner's output into the review verdict/findings shape and returns it unchanged", async () => {
    const review = makeReview();
    const { agent } = buildAgent(review);

    const result = await agent.run(makePlan(), makeReport(), "some diff", makeTaskBundle(), "run-1");

    expect(result).toEqual(review);
    expect(result.reviewId).toBe("rev-001");
    expect(result.overallVerdict).toBe("changes_requested");
    expect(result.findings).toHaveLength(3);
  });

  it("logs blocker and important finding counts computed from the parsed findings", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeReport(), "some diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.reviewId).toBe("rev-001");
    expect(payload?.verdict).toBe("changes_requested");
    expect(payload?.totalFindings).toBe(3);
    expect(payload?.blockerCount).toBe(1);
    expect(payload?.importantCount).toBe(1);
  });

  it("handles an empty findings array: zero counts, and an approved verdict is preserved", async () => {
    const emptyReview = makeReview({ findings: [], overallVerdict: "approved" });
    const { agent, logger, artifactRepo } = buildAgent(emptyReview);

    const result = await agent.run(makePlan(), makeReport(), "some diff", makeTaskBundle(), "run-1");

    expect(result.findings).toEqual([]);
    expect(result.overallVerdict).toBe("approved");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.totalFindings).toBe(0);
    expect(payload?.blockerCount).toBe(0);
    expect(payload?.importantCount).toBe(0);

    const reviewArtifact = artifactRepo.create.mock.calls
      .map((c: unknown[]) => c[0] as { type: string })
      .find((a) => a.type === "Review");
    expect(reviewArtifact).toBeDefined();
  });

  it("counts multiple blockers and multiple important findings independently of suggestion/nit findings", async () => {
    const review = makeReview({
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t1", details: "d1" },
        { id: "f2", severity: "blocker", type: "bug", file: "a.ts", title: "t2", details: "d2" },
        {
          id: "f3",
          severity: "important",
          type: "bug",
          file: "a.ts",
          title: "t3",
          details: "d3",
        },
        { id: "f4", severity: "suggestion", type: "style", file: "a.ts", title: "t4", details: "d4" },
        { id: "f5", severity: "nit", type: "style", file: "a.ts", title: "t5", details: "d5" },
      ],
    });
    const { agent, logger } = buildAgent(review);

    await agent.run(makePlan(), makeReport(), "some diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.totalFindings).toBe(5);
    expect(payload?.blockerCount).toBe(2);
    expect(payload?.importantCount).toBe(1);
  });

  it("propagates a rejection when the agent runner throws, and never persists any artifacts", async () => {
    const { agent, artifactRepo } = buildAgent(undefined, async () => {
      throw new Error("Codex CLI timed out");
    });

    await expect(
      agent.run(makePlan(), makeReport(), "some diff", makeTaskBundle(), "run-1"),
    ).rejects.toThrow("Codex CLI timed out");

    expect(artifactRepo.create).not.toHaveBeenCalled();
  });

  it("propagates a schema-validation error thrown by the underlying runner without persisting artifacts", async () => {
    const { agent, artifactRepo } = buildAgent(undefined, async () => {
      throw new Error("Output failed schema validation: payload.overallVerdict required");
    });

    await expect(
      agent.run(makePlan(), makeReport(), "some diff", makeTaskBundle(), "run-1"),
    ).rejects.toThrow(/schema validation/);

    expect(artifactRepo.create).not.toHaveBeenCalled();
  });

  it("logs a 'Starting reviewer agent' info event before invoking the runner", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeReport(), "some diff", makeTaskBundle(), "run-7");

    expect(logger.info).toHaveBeenCalledWith(
      { runId: "run-7" },
      "Starting reviewer agent (Codex CLI)",
    );
  });
});
