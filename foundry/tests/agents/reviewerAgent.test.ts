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
    reviewId: "rev-1",
    overallVerdict: "changes_requested",
    summary: "Found some issues",
    findings: [
      { id: "f1", severity: "blocker", description: "Bad bug", location: "src/foo.ts" },
      { id: "f2", severity: "important", description: "Nit", location: "src/foo.ts" },
      { id: "f3", severity: "minor", description: "Style", location: "src/foo.ts" },
    ] as never,
    ...overrides,
  } as Review;
}

function buildAgent(reviewOverrides: Partial<Review> = {}) {
  const review = makeReview(reviewOverrides);

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

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, agentRunner, artifactRepo, logger, review };
}

describe("ReviewerAgent.run()", () => {
  it("renders the reviewer prompts with the task bundle, plan, report, and diff", async () => {
    const { agent, agentRunner } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/x b/x", makeTaskBundle(), "run-1");

    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    const [, input, stage] = agentRunner.run.mock.calls[0]!;
    expect(stage).toBe("reviewer");
    expect((input as { workingDirectory: string }).workingDirectory).toBe("/tmp");
    expect((input as { prompt: string }).prompt).not.toContain("{{");
  });

  it("persists both the raw transcript artifact and the parsed Review artifact", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0] as { type: string });
    expect(calls.some((c) => c.type === "ReviewerTranscript")).toBe(true);
    expect(calls.some((c) => c.type === "Review")).toBe(true);
  });

  it("returns the parsed review unchanged", async () => {
    const { agent, review } = buildAgent();

    const result = await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(result).toEqual(review);
  });

  it("logs blocker and important finding counts separately from minor findings", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.blockerCount).toBe(1);
    expect(payload.importantCount).toBe(1);
    expect(payload.totalFindings).toBe(3);
    expect(payload.verdict).toBe("changes_requested");
  });

  it("reports zero blockers and importants when the review is clean", async () => {
    const { agent, logger } = buildAgent({ overallVerdict: "approved", findings: [] as never });

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.blockerCount).toBe(0);
    expect(payload.importantCount).toBe(0);
    expect(payload.verdict).toBe("approved");
  });
});
