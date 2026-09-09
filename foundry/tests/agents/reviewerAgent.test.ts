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
    summary: "Plan summary",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do it" }],
    testPlan: "Run tests",
    confidence: 0.9,
  };
}

function makeExecutionReport(): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Solid.",
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
    summary: "Looks good with one blocker.",
    findings: [
      {
        id: "f1",
        severity: "blocker",
        type: "bug",
        file: "src/a.ts",
        title: "Null deref",
        details: "Will crash",
      },
      {
        id: "f2",
        severity: "important",
        type: "bug",
        file: "src/a.ts",
        title: "Off by one",
        details: "Loop bound wrong",
      },
      {
        id: "f3",
        severity: "nit",
        type: "style",
        file: "src/a.ts",
        title: "Naming",
        details: "Rename variable",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function buildAgent(reviewOverride?: Review) {
  let capturedPrompt = "";
  let capturedSystemPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (_runtime: unknown, opts: { prompt: string; systemPrompt: string }) => {
        capturedPrompt = opts.prompt;
        capturedSystemPrompt = opts.systemPrompt;
        return {
          raw: "raw reviewer transcript",
          parsed: { stage: "reviewer" as const, payload: reviewOverride ?? makeReview() },
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
    getPrompt: () => capturedPrompt,
    getSystemPrompt: () => capturedSystemPrompt,
  };
}

describe("ReviewerAgent.run()", () => {
  it("renders the plan, execution report, and diff into the prompts", async () => {
    const { agent, getPrompt, getSystemPrompt } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/x b/x", makeTaskBundle(), "run-1");

    const prompt = getPrompt();
    expect(prompt).toContain("Plan summary");
    expect(prompt).toContain("Implemented the feature");
    expect(prompt).toContain("diff --git a/x b/x");
    expect(getSystemPrompt()).not.toContain("{{");
  });

  it("writes a ReviewerTranscript artifact and a Review artifact", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      type: string;
      version: number;
    }[];
    expect(calls.find((a) => a.type === "ReviewerTranscript")).toBeDefined();
    const reviewArtifact = calls.find((a) => a.type === "Review");
    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact?.version).toBe(1);
  });

  it("returns the parsed review and logs blocker/important finding counts", async () => {
    const { agent, logger } = buildAgent();

    const review = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff",
      makeTaskBundle(),
      "run-1",
    );

    expect(review.reviewId).toBe("rev-001");
    expect(review.findings).toHaveLength(3);

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.blockerCount).toBe(1);
    expect(payload.importantCount).toBe(1);
    expect(payload.totalFindings).toBe(3);
    expect(payload.verdict).toBe("changes_requested");
  });

  it("logs zero blocker/important counts for an approved review with no findings", async () => {
    const { agent, logger } = buildAgent(
      makeReview({ findings: [], overallVerdict: "approved" }),
    );

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.blockerCount).toBe(0);
    expect(payload.importantCount).toBe(0);
    expect(payload.verdict).toBe("approved");
  });
});
