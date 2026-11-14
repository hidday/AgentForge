import { describe, it, expect, vi } from "vitest";
import { ReviewerAgent } from "../../src/agents/reviewerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

function makeTaskBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "Test issue", description: "desc", labels: [], priority: 0 },
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
    steps: [],
    testPlan: "Run tests",
    confidence: 0.9,
  };
}

function makeExecutionReport(): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "done",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "" },
      typecheck: { status: "pass", details: "" },
      tests: { status: "pass", details: "" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "good",
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "looks good",
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
  const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);
  return { agent, agentRunner, artifactRepo, logger };
}

describe("ReviewerAgent.run()", () => {
  it("runs the reviewer stage on the Codex runtime and returns the parsed review", async () => {
    const { agent, agentRunner } = buildAgent(makeReview());

    const review = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff --git a/a.ts b/a.ts",
      makeTaskBundle(),
      "run-1",
    );

    expect(review.overallVerdict).toBe("approved");
    expect(agentRunner.run).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({ runId: "run-1", workingDirectory: "/tmp" }),
      "reviewer",
      expect.anything(),
    );
  });

  it("persists both a ReviewerTranscript and a Review artifact", async () => {
    const { agent, artifactRepo } = buildAgent(makeReview());

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const types = artifactRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { type: string }).type);
    expect(types).toEqual(["ReviewerTranscript", "Review"]);
  });

  it("logs blocker and important finding counts on completion", async () => {
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t1", details: "d1" },
        { id: "f2", severity: "important", type: "bug", file: "a.ts", title: "t2", details: "d2" },
        { id: "f3", severity: "nit", type: "style", file: "a.ts", title: "t3", details: "d3" },
      ],
    });
    const { agent, logger } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.blockerCount).toBe(1);
    expect(payload.importantCount).toBe(1);
    expect(payload.totalFindings).toBe(3);
    expect(payload.verdict).toBe("changes_requested");
  });
});
