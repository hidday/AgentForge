import { describe, it, expect, vi } from "vitest";
import { ReviewerAgent } from "../../src/agents/reviewerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review, Finding } from "../../src/schemas/review.js";

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

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "important",
    type: "bug",
    file: "src/foo.ts",
    title: "Something",
    details: "Some details",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
    summary: "Looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function buildAgent(review: Review = makeReview()) {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";
  let capturedRuntime: unknown;
  let capturedStage: unknown;
  let capturedSchema: unknown;

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        runtime: unknown,
        opts: { prompt: string; systemPrompt: string },
        stage: unknown,
        schema: unknown,
      ) => {
        capturedRuntime = runtime;
        capturedSystemPrompt = opts.systemPrompt;
        capturedUserPrompt = opts.prompt;
        capturedStage = stage;
        capturedSchema = schema;
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
    getRuntime: () => capturedRuntime,
    getStage: () => capturedStage,
    getSchema: () => capturedSchema,
  };
}

describe("ReviewerAgent.run()", () => {
  it("logs the start of the reviewer agent", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/x b/x", makeTaskBundle(), "run-1");

    expect(logger.info).toHaveBeenCalledWith(
      { runId: "run-1" },
      "Starting reviewer agent (Codex CLI)",
    );
  });

  it("invokes the agent runner on the reviewer's codex runtime with rendered prompts", async () => {
    const { agent, getRuntime, getStage, getSchema, getSystemPrompt, getUserPrompt } =
      buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff content here", makeTaskBundle(), "run-1");

    expect(getRuntime()).toBe("codex");
    expect(getStage()).toBe("reviewer");
    expect(getSchema()).toBeDefined();
    // Prompts are rendered from taskBundle + plan + executionReport + diff,
    // so unresolved template placeholders should not leak through.
    expect(getSystemPrompt()).not.toContain("{{");
    expect(getUserPrompt()).not.toContain("{{");
  });

  it("passes the repo's repoPath as the working directory and env.AGENT_TIMEOUT_MS as the timeout", async () => {
    const { agent, agentRunner } = buildAgent();
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff", bundle, "run-42");

    const callArgs = agentRunner.run.mock.calls[0] as unknown[];
    const opts = callArgs[1] as { workingDirectory: string; timeoutMs: number; runId: string };
    expect(opts.workingDirectory).toBe(bundle.repo.repoPath);
    expect(opts.runId).toBe("run-42");
    expect(typeof opts.timeoutMs).toBe("number");
  });

  it("persists a ReviewerTranscript artifact with the raw transcript text", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      runId: string;
      type: string;
      version: number;
      rawText: string;
    }[];
    const transcript = calls.find((a) => a.type === "ReviewerTranscript");
    expect(transcript).toBeDefined();
    expect(transcript?.runId).toBe("run-1");
    expect(transcript?.version).toBe(3);
    expect(transcript?.rawText).toBe("raw reviewer transcript");
  });

  it("persists a Review artifact with the parsed review payload as JSON", async () => {
    const review = makeReview({
      reviewId: "rev-999",
      summary: "Found issues",
      overallVerdict: "changes_requested",
      findings: [makeFinding()],
    });
    const { agent, artifactRepo } = buildAgent(review);

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
    expect(reviewArtifact?.payloadJson).toEqual(review);
    expect(JSON.parse(reviewArtifact?.rawText ?? "{}")).toEqual(review);
  });

  it("returns the parsed review", async () => {
    const review = makeReview({ reviewId: "rev-abc" });
    const { agent } = buildAgent(review);

    const result = await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(result).toEqual(review);
  });

  it("counts blocker and important findings separately from suggestions and nits in the completion log", async () => {
    const review = makeReview({
      findings: [
        makeFinding({ id: "f1", severity: "blocker" }),
        makeFinding({ id: "f2", severity: "blocker" }),
        makeFinding({ id: "f3", severity: "important" }),
        makeFinding({ id: "f4", severity: "suggestion" }),
        makeFinding({ id: "f5", severity: "nit" }),
      ],
      overallVerdict: "changes_requested",
    });
    const { agent, logger } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.blockerCount).toBe(2);
    expect(payload?.importantCount).toBe(1);
    expect(payload?.totalFindings).toBe(5);
    expect(payload?.verdict).toBe("changes_requested");
    expect(payload?.reviewId).toBe("rev-001");
  });

  it("logs blockerCount=0 and importantCount=0 when the review has no blocking findings", async () => {
    const review = makeReview({
      findings: [makeFinding({ id: "f1", severity: "nit" })],
      overallVerdict: "approved",
    });
    const { agent, logger } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.blockerCount).toBe(0);
    expect(payload?.importantCount).toBe(0);
    expect(payload?.totalFindings).toBe(1);
    expect(payload?.verdict).toBe("approved");
  });

  it("propagates a rejection when the agent runner fails (malformed LLM output / runner failure)", async () => {
    const { agent, artifactRepo } = buildAgent();
    // Force a runner failure (e.g. schema validation failure on malformed CLI output).
    (agent as unknown as { agentRunner: { run: ReturnType<typeof vi.fn> } });
    const failingAgentRunner = { run: vi.fn().mockRejectedValue(new Error("invalid structured output")) };
    const failingAgent = new ReviewerAgent(
      failingAgentRunner as never,
      artifactRepo as never,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    );

    await expect(
      failingAgent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1"),
    ).rejects.toThrow("invalid structured output");

    // No artifacts should be persisted since the failure happens before parsing.
    expect(artifactRepo.create).not.toHaveBeenCalled();
  });
});
