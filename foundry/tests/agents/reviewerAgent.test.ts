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
    reviewId: "review-001",
    summary: "Looks reasonable",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function buildAgent(reviewOverrides: Partial<Review> = {}) {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";
  let capturedRuntimeArg: unknown;
  let capturedTimeoutMs: unknown;

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        runtime: unknown,
        opts: { prompt: string; systemPrompt: string; timeoutMs: number },
      ) => {
        capturedRuntimeArg = runtime;
        capturedSystemPrompt = opts.systemPrompt;
        capturedUserPrompt = opts.prompt;
        capturedTimeoutMs = opts.timeoutMs;
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
    getRuntimeArg: () => capturedRuntimeArg,
    getTimeoutMs: () => capturedTimeoutMs,
  };
}

describe("ReviewerAgent.run()", () => {
  it("logs the start of the reviewer agent", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a b", makeTaskBundle(), "run-1");

    const startLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Starting reviewer agent (Codex CLI)",
    );
    expect(startLog).toBeDefined();
    expect((startLog?.[0] as Record<string, unknown>)?.runId).toBe("run-1");
  });

  it("renders the diff and execution report into the prompts", async () => {
    const { agent, getSystemPrompt, getUserPrompt } = buildAgent();
    const diff = "diff --git a/src/foo.ts b/src/foo.ts\n+added line";

    await agent.run(makePlan(), makeExecutionReport(), diff, makeTaskBundle(), "run-1");

    const combined = getSystemPrompt() + getUserPrompt();
    expect(combined).not.toContain("{{diff}}");
    expect(combined).not.toContain("{{executionReport.summary}}");
  });

  it("passes the reviewer runtime stage, working directory, and timeout to the agent runner", async () => {
    const { agent, getRuntimeArg, getTimeoutMs, agentRunner } = buildAgent();
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff", bundle, "run-1");

    expect(getRuntimeArg()).toBeDefined();
    expect(typeof getTimeoutMs()).toBe("number");
    const callArgs = agentRunner.run.mock.calls[0];
    expect(callArgs[1].workingDirectory).toBe(bundle.repo.repoPath);
    expect(callArgs[1].runId).toBe("run-1");
    expect(callArgs[2]).toBe("reviewer");
  });

  it("persists a ReviewerTranscript artifact with the raw output", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]);
    const transcript = calls.find(
      (a: unknown) => (a as { type?: string }).type === "ReviewerTranscript",
    ) as { version: number; rawText: string };
    expect(transcript).toBeDefined();
    expect(transcript.version).toBe(3);
    expect(transcript.rawText).toBe("raw reviewer transcript");
  });

  it("persists a Review artifact with the parsed review payload", async () => {
    const { agent, artifactRepo } = buildAgent({ summary: "Needs work" });

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]);
    const reviewArtifact = calls.find(
      (a: unknown) => (a as { type?: string }).type === "Review",
    ) as { version: number; payloadJson: Review; rawText: string };
    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact.version).toBe(1);
    expect(reviewArtifact.payloadJson.summary).toBe("Needs work");
    expect(JSON.parse(reviewArtifact.rawText).summary).toBe("Needs work");
  });

  it("counts blocker and important findings separately in the completion log", async () => {
    const { agent, logger } = buildAgent({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "Bug A", details: "x" },
        { id: "f2", severity: "blocker", type: "bug", file: "b.ts", title: "Bug B", details: "y" },
        {
          id: "f3",
          severity: "important",
          type: "style",
          file: "c.ts",
          title: "Style issue",
          details: "z",
        },
        { id: "f4", severity: "nit", type: "nit", file: "d.ts", title: "Nit", details: "w" },
      ],
    });

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.verdict).toBe("changes_requested");
    expect(payload.totalFindings).toBe(4);
    expect(payload.blockerCount).toBe(2);
    expect(payload.importantCount).toBe(1);
  });

  it("returns the parsed review unchanged", async () => {
    const { agent } = buildAgent({ reviewId: "review-xyz" });

    const result = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff",
      makeTaskBundle(),
      "run-1",
    );

    expect(result.reviewId).toBe("review-xyz");
  });
});
