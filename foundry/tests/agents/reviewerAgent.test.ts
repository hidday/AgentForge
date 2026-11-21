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

function makeExecutionReport(): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented things.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Solid",
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Looks mostly good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function buildAgent(review: Review) {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string; systemPrompt: string }) => {
      capturedSystemPrompt = opts.systemPrompt;
      capturedUserPrompt = opts.prompt;
      return {
        raw: "raw reviewer transcript",
        parsed: { stage: "reviewer" as const, payload: review },
      };
    }),
  };

  const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

  return {
    agent,
    agentRunner,
    artifactRepo,
    logger,
    getSystemPrompt: () => capturedSystemPrompt,
    getUserPrompt: () => capturedUserPrompt,
  };
}

describe("ReviewerAgent.run()", () => {
  it("renders the system and user prompts with the plan, report, and diff", async () => {
    const { agent, getSystemPrompt, getUserPrompt } = buildAgent(makeReview());

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/x b/x", makeTaskBundle(), "run-1");

    expect(getSystemPrompt().length).toBeGreaterThan(0);
    expect(getUserPrompt()).not.toContain("{{");
  });

  it("routes to the reviewer stage's configured runtime (codex)", async () => {
    const { agent, agentRunner } = buildAgent(makeReview());

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(agentRunner.run).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({ runId: "run-1" }),
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

  it("returns the parsed review unchanged", async () => {
    const review = makeReview({ overallVerdict: "changes_requested" });
    const { agent } = buildAgent(review);

    const result = await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(result).toEqual(review);
  });

  it("logs the review completion with blocker/important finding counts", async () => {
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

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        reviewId: "rev-1",
        verdict: "changes_requested",
        totalFindings: 3,
        blockerCount: 1,
        importantCount: 1,
      }),
      "Review completed",
    );
  });
});
