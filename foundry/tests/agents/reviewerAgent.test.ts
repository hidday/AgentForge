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
    scoreRationale: "Implementation looks solid.",
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
    summary: "Looks mostly fine.",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function buildAgent(reviewOverrides: Partial<Review> = {}) {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (_runtime: unknown, opts: { prompt: string; systemPrompt?: string }) => {
        capturedSystemPrompt = opts.systemPrompt ?? "";
        capturedUserPrompt = opts.prompt;
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
  };
}

describe("ReviewerAgent.run()", () => {
  it("calls the agent runner on the codex runtime with the issue, plan, report and diff rendered into the prompt", async () => {
    const { agent, agentRunner, getUserPrompt } = buildAgent();

    await agent.run(makePlan(), makeReport(), "diff --git a/src/foo.ts b/src/foo.ts", makeTaskBundle(), "run-1");

    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    const [runtime, opts, stage] = agentRunner.run.mock.calls[0] as [string, { workingDirectory: string; timeoutMs: number; runId?: string }, string];
    expect(runtime).toBe("codex");
    expect(stage).toBe("reviewer");
    expect(opts.workingDirectory).toBe("/tmp");
    expect(opts.runId).toBe("run-1");

    const userPrompt = getUserPrompt();
    expect(userPrompt).toContain("LIN-1");
    expect(userPrompt).toContain("Implemented things.");
    expect(userPrompt).toContain("diff --git a/src/foo.ts b/src/foo.ts");
  });

  it("logs the start of the reviewer agent run", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    expect(logger.info).toHaveBeenCalledWith({ runId: "run-1" }, "Starting reviewer agent (Codex CLI)");
  });

  it("persists a ReviewerTranscript artifact with the raw model output", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as Array<{
      type: string;
      version: number;
      rawText: string;
    }>;
    const transcript = calls.find((a) => a.type === "ReviewerTranscript");
    expect(transcript).toBeDefined();
    expect(transcript?.version).toBe(3);
    expect(transcript?.rawText).toBe("raw reviewer transcript");
  });

  it("persists a Review artifact with the parsed review payload", async () => {
    const { agent, artifactRepo } = buildAgent({ overallVerdict: "changes_requested" });

    const review = await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as Array<{
      type: string;
      version: number;
      payloadJson: unknown;
    }>;
    const reviewArtifact = calls.find((a) => a.type === "Review");
    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact?.version).toBe(1);
    expect((reviewArtifact?.payloadJson as Review).overallVerdict).toBe("changes_requested");
    expect(review.overallVerdict).toBe("changes_requested");
  });

  it("counts blocker and important findings separately and logs them in the completion event", async () => {
    const { agent, logger } = buildAgent({
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t1", details: "d1" },
        { id: "f2", severity: "blocker", type: "bug", file: "b.ts", title: "t2", details: "d2" },
        { id: "f3", severity: "important", type: "style", file: "c.ts", title: "t3", details: "d3" },
        { id: "f4", severity: "nit", type: "style", file: "d.ts", title: "t4", details: "d4" },
        { id: "f5", severity: "suggestion", type: "style", file: "e.ts", title: "t5", details: "d5" },
      ],
    });

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Review completed");
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.blockerCount).toBe(2);
    expect(payload?.importantCount).toBe(1);
    expect(payload?.totalFindings).toBe(5);
    expect(payload?.verdict).toBe("approved");
  });

  it("returns the parsed review object to the caller", async () => {
    const { agent } = buildAgent({ reviewId: "rev-custom", summary: "Custom summary" });

    const review = await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    expect(review.reviewId).toBe("rev-custom");
    expect(review.summary).toBe("Custom summary");
  });
});
