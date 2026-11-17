import { describe, it, expect, vi } from "vitest";
import { ReviewerAgent } from "../../src/agents/reviewerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

function makeTaskBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "Test issue", description: "Test description", labels: [], priority: 0 },
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

function makeReport(): ExecutionReport {
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
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Review summary",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function buildAgent(review: Review) {
  const agentRunner = {
    run: vi.fn().mockResolvedValue({
      raw: "raw reviewer transcript",
      parsed: { stage: "reviewer" as const, payload: review },
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, agentRunner, artifactRepo, logger };
}

describe("ReviewerAgent.run()", () => {
  it("persists a ReviewerTranscript artifact with the raw agent output", async () => {
    const review = makeReview();
    const { agent, artifactRepo } = buildAgent(review);

    await agent.run(makePlan(), makeReport(), "diff --git a/x b/x", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as Array<{
      runId: string;
      type: string;
      version: number;
      rawText: string;
    }>;
    const transcript = calls.find((c) => c.type === "ReviewerTranscript");
    expect(transcript).toBeDefined();
    expect(transcript?.runId).toBe("run-1");
    expect(transcript?.version).toBe(3);
    expect(transcript?.rawText).toBe("raw reviewer transcript");
  });

  it("persists a Review artifact with version 1 and the parsed review as payload", async () => {
    const review = makeReview({ reviewId: "rev-42", overallVerdict: "changes_requested" });
    const { agent, artifactRepo } = buildAgent(review);

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as Array<{
      type: string;
      version: number;
      payloadJson: unknown;
    }>;
    const reviewArtifact = calls.find((c) => c.type === "Review");
    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact?.version).toBe(1);
    expect((reviewArtifact?.payloadJson as Review).reviewId).toBe("rev-42");
  });

  it("returns the parsed review to the caller", async () => {
    const review = makeReview({ reviewId: "rev-7" });
    const { agent } = buildAgent(review);

    const result = await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    expect(result.reviewId).toBe("rev-7");
  });

  it("logs blocker and important finding counts computed from mixed-severity findings", async () => {
    const review = makeReview({
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
        {
          id: "f5",
          severity: "suggestion",
          type: "scope",
          file: "e.ts",
          title: "t5",
          details: "d5",
        },
      ],
      overallVerdict: "changes_requested",
    });
    const { agent, logger } = buildAgent(review);

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.reviewId).toBe("rev-1");
    expect(payload.verdict).toBe("changes_requested");
    expect(payload.totalFindings).toBe(5);
    expect(payload.blockerCount).toBe(2);
    expect(payload.importantCount).toBe(1);
  });

  it("reports zero blocker/important counts when all findings are low severity", async () => {
    const review = makeReview({
      findings: [
        { id: "f1", severity: "nit", type: "style", file: "a.ts", title: "t1", details: "d1" },
      ],
    });
    const { agent, logger } = buildAgent(review);

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.blockerCount).toBe(0);
    expect(payload.importantCount).toBe(0);
  });

  it("passes the runtime, prompts, working directory and runId through to the agent runner", async () => {
    const { agent, agentRunner } = buildAgent(makeReview());
    const taskBundle = makeTaskBundle();

    await agent.run(makePlan(), makeReport(), "diff", taskBundle, "run-99");

    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    const [runtime, opts, stage] = agentRunner.run.mock.calls[0] as [
      string,
      { workingDirectory: string; runId: string; prompt: string; systemPrompt: string },
      string,
    ];
    expect(stage).toBe("reviewer");
    expect(opts.workingDirectory).toBe(taskBundle.repo.repoPath);
    expect(opts.runId).toBe("run-99");
    expect(typeof opts.prompt).toBe("string");
    expect(typeof opts.systemPrompt).toBe("string");
  });
});
