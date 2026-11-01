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
    summary: "Looks good overall.",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function buildAgent(reviewOverrides: Partial<Review> = {}) {
  const agentRunner = {
    run: vi.fn().mockResolvedValue({
      raw: "raw reviewer transcript",
      parsed: {
        stage: "reviewer" as const,
        payload: makeReview(reviewOverrides),
      },
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

  return { agent, agentRunner, artifactRepo, logger };
}

describe("ReviewerAgent.run()", () => {
  it("persists a ReviewerTranscript artifact with the raw CLI output", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a b", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]);
    const transcript = calls.find((a: unknown) => (a as { type?: string }).type === "ReviewerTranscript") as {
      runId: string;
      version: number;
      rawText: string;
    };
    expect(transcript).toBeDefined();
    expect(transcript.runId).toBe("run-1");
    expect(transcript.version).toBe(3);
    expect(transcript.rawText).toBe("raw reviewer transcript");
  });

  it("persists a Review artifact with the parsed review payload", async () => {
    const { agent, artifactRepo } = buildAgent({ overallVerdict: "changes_requested" });

    const review = await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(review.overallVerdict).toBe("changes_requested");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]);
    const reviewArtifact = calls.find((a: unknown) => (a as { type?: string }).type === "Review") as {
      version: number;
      payloadJson: Review;
    };
    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact.version).toBe(1);
    expect(reviewArtifact.payloadJson.overallVerdict).toBe("changes_requested");
  });

  it("logs blocker and important finding counts separately from other severities", async () => {
    const { agent, logger } = buildAgent({
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t1", details: "d1" },
        { id: "f2", severity: "important", type: "bug", file: "b.ts", title: "t2", details: "d2" },
        { id: "f3", severity: "important", type: "bug", file: "c.ts", title: "t3", details: "d3" },
        { id: "f4", severity: "nit", type: "style", file: "d.ts", title: "t4", details: "d4" },
      ],
    });

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.totalFindings).toBe(4);
    expect(payload.blockerCount).toBe(1);
    expect(payload.importantCount).toBe(2);
  });

  it("passes the diff and taskBundle fields through to the rendered prompts via the agent runner call", async () => {
    const { agent, agentRunner } = buildAgent();
    const taskBundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/b", taskBundle, "run-42");

    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    const [runtime, opts, stage] = agentRunner.run.mock.calls[0];
    expect(runtime).toBe("codex");
    expect(stage).toBe("reviewer");
    expect((opts as { runId: string }).runId).toBe("run-42");
    expect((opts as { workingDirectory: string }).workingDirectory).toBe(taskBundle.repo.repoPath);
    expect((opts as { prompt: string }).prompt).toContain("diff --git a/b");
  });
});
