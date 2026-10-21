import { describe, it, expect, vi } from "vitest";
import { ReviewerAgent } from "../../src/agents/reviewerAgent.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Review } from "../../src/schemas/review.js";

function makePlan(): Plan {
  return {
    planVersion: 1,
    summary: "Add a feature",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do it" }],
    testPlan: "Run tests",
    confidence: 0.9,
  };
}

function makeReport(): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "All green.",
  };
}

function makeTaskBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "Test issue", description: "desc", labels: [], priority: 0 },
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
    summary: "Looks fine, one nit.",
    findings: [
      {
        id: "f1",
        severity: "important",
        type: "bug",
        file: "src/foo.ts",
        title: "Missing check",
        details: "Could fail",
      },
      {
        id: "f2",
        severity: "nit",
        type: "style",
        file: "src/foo.ts",
        title: "Nit",
        details: "Style",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function buildAgent(reviewOverride?: Review) {
  let capturedOpts: { prompt: string; systemPrompt: string; workingDirectory: string; timeoutMs: number; runId: string } | null =
    null;

  const agentRunner = {
    run: vi.fn().mockImplementation(async (_runtime: unknown, opts: typeof capturedOpts) => {
      capturedOpts = opts;
      return {
        raw: "raw reviewer transcript",
        parsed: {
          stage: "reviewer" as const,
          payload: reviewOverride ?? makeReview(),
        },
      };
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, agentRunner, artifactRepo, logger, getOpts: () => capturedOpts };
}

describe("ReviewerAgent.run()", () => {
  it("calls the agent runner on the codex runtime with the rendered prompts and run metadata", async () => {
    const { agent, agentRunner, getOpts } = buildAgent();

    await agent.run(makePlan(), makeReport(), "diff --git a b", makeTaskBundle(), "run-1");

    expect(agentRunner.run).toHaveBeenCalledWith(
      "codex",
      expect.any(Object),
      "reviewer",
      expect.any(Object),
    );
    const opts = getOpts();
    expect(opts?.runId).toBe("run-1");
    expect(opts?.workingDirectory).toBe("/tmp/repo");
    expect(opts?.systemPrompt.length).toBeGreaterThan(0);
    expect(opts?.prompt.length).toBeGreaterThan(0);
  });

  it("writes a ReviewerTranscript artifact with the raw output", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      type: string;
      rawText: string;
    }[];
    const transcript = calls.find((a) => a.type === "ReviewerTranscript");
    expect(transcript).toBeDefined();
    expect(transcript?.rawText).toBe("raw reviewer transcript");
  });

  it("writes a Review artifact with the parsed payload as JSON", async () => {
    const review = makeReview();
    const { agent, artifactRepo } = buildAgent(review);

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      type: string;
      version: number;
      payloadJson: unknown;
    }[];
    const reviewArtifact = calls.find((a) => a.type === "Review");
    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact?.version).toBe(1);
    expect(reviewArtifact?.payloadJson).toEqual(review);
  });

  it("returns the parsed review and logs blocker/important finding counts", async () => {
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
        { id: "f4", severity: "nit", type: "style", file: "a.ts", title: "t4", details: "d4" },
      ],
      overallVerdict: "changes_requested",
    });
    const { agent, logger } = buildAgent(review);

    const result = await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    expect(result).toEqual(review);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        reviewId: "rev-1",
        verdict: "changes_requested",
        totalFindings: 4,
        blockerCount: 2,
        importantCount: 1,
      }),
      "Review completed",
    );
  });
});
