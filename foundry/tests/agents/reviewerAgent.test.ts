import { describe, it, expect, vi } from "vitest";
import { ReviewerAgent } from "../../src/agents/reviewerAgent.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Review } from "../../src/schemas/review.js";

function makePlan(): Plan {
  return {
    planVersion: 1,
    summary: "summary",
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

function makeBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
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

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Looks solid overall",
    findings: [
      {
        id: "f1",
        severity: "blocker",
        type: "bug",
        file: "src/a.ts",
        title: "Null deref",
        details: "foo can be null",
      },
      {
        id: "f2",
        severity: "important",
        type: "bug",
        file: "src/b.ts",
        title: "Off by one",
        details: "loop runs one extra time",
      },
      {
        id: "f3",
        severity: "nit",
        type: "style",
        file: "src/c.ts",
        title: "naming",
        details: "could be clearer",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function buildAgent(review: Review = makeReview()) {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (_runtime: unknown, opts: { prompt: string; systemPrompt: string }) => {
        capturedSystemPrompt = opts.systemPrompt;
        capturedUserPrompt = opts.prompt;
        return {
          raw: "raw reviewer transcript",
          parsed: { stage: "reviewer" as const, payload: review },
        };
      },
    ),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };

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
  it("renders the review templates with the plan, execution report, and diff", async () => {
    const { agent, getSystemPrompt, getUserPrompt } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/src/a.ts", makeBundle(), "run-1");

    expect(getSystemPrompt().length).toBeGreaterThan(0);
    expect(getUserPrompt()).not.toContain("{{diff}}");
  });

  it("routes execution to the agent's configured runtime for the reviewer stage", async () => {
    const { agent, agentRunner } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeBundle(), "run-1");

    expect(agentRunner.run).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({ workingDirectory: "/tmp/repo", runId: "run-1" }),
      "reviewer",
      expect.anything(),
    );
  });

  it("writes a ReviewerTranscript and a Review artifact", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeBundle(), "run-1");

    const types = artifactRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { type: string }).type);
    expect(types).toContain("ReviewerTranscript");
    expect(types).toContain("Review");
  });

  it("returns the parsed review payload", async () => {
    const review = makeReview({ overallVerdict: "approved", findings: [] });
    const { agent } = buildAgent(review);

    const result = await agent.run(makePlan(), makeExecutionReport(), "diff", makeBundle(), "run-1");

    expect(result.overallVerdict).toBe("approved");
    expect(result.findings).toEqual([]);
  });

  it("logs blocker and important finding counts on completion", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.blockerCount).toBe(1);
    expect(payload.importantCount).toBe(1);
    expect(payload.totalFindings).toBe(3);
  });
});
