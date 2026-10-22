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
    reviewId: "review-1",
    summary: "Looks reasonable overall.",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function buildAgent(reviewOverrides: Partial<Review> = {}) {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";
  let capturedRuntime: unknown;
  let capturedStage: unknown;

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        runtime: unknown,
        opts: { prompt: string; systemPrompt: string },
        stage: unknown,
      ) => {
        capturedRuntime = runtime;
        capturedStage = stage;
        capturedSystemPrompt = opts.systemPrompt;
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
    getRuntime: () => capturedRuntime,
    getStage: () => capturedStage,
  };
}

describe("ReviewerAgent.run()", () => {
  it("renders prompts from the task bundle, plan, execution report, and diff", async () => {
    const { agent, getSystemPrompt, getUserPrompt } = buildAgent();

    await agent.run(makePlan(), makeReport(), "diff --git a/foo b/foo", makeTaskBundle(), "run-1");

    const systemPrompt = getSystemPrompt();
    const userPrompt = getUserPrompt();
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(userPrompt.length).toBeGreaterThan(0);
    // Templated fields should have been substituted, not left as raw placeholders.
    expect(userPrompt).not.toContain("{{diff}}");
    expect(userPrompt).toContain("diff --git a/foo b/foo");
  });

  it("invokes the agent runner with the reviewer stage/runtime and the repo working directory", async () => {
    const { agent, getRuntime, getStage } = buildAgent();

    await agent.run(makePlan(), makeReport(), "some diff", makeTaskBundle(), "run-1");

    expect(getStage()).toBe("reviewer");
    expect(getRuntime()).toBeDefined();
  });

  it("persists a ReviewerTranscript artifact with the raw model output", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]);
    const transcript = calls.find(
      (a: unknown) => (a as { type?: string }).type === "ReviewerTranscript",
    ) as { version: number; rawText: string; runId: string };

    expect(transcript).toBeDefined();
    expect(transcript.version).toBe(3);
    expect(transcript.rawText).toBe("raw reviewer transcript");
    expect(transcript.runId).toBe("run-1");
  });

  it("persists a Review artifact whose payload matches the parsed review", async () => {
    const { agent, artifactRepo } = buildAgent({ overallVerdict: "changes_requested" });

    const result = await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]);
    const reviewArtifact = calls.find(
      (a: unknown) => (a as { type?: string }).type === "Review",
    ) as { version: number; payloadJson: Review; rawText: string };

    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact.version).toBe(1);
    expect(reviewArtifact.payloadJson.overallVerdict).toBe("changes_requested");
    expect(reviewArtifact.rawText).toBe(JSON.stringify(result, null, 2));
  });

  it("returns the parsed review to the caller", async () => {
    const { agent } = buildAgent({ summary: "Custom summary" });

    const result = await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    expect(result.summary).toBe("Custom summary");
    expect(result.overallVerdict).toBe("approved");
  });

  it("logs blocker and important finding counts from the review", async () => {
    const { agent, logger } = buildAgent({
      reviewId: "review-42",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "bug",
          file: "src/foo.ts",
          title: "Null deref",
          details: "May crash",
        },
        {
          id: "f2",
          severity: "important",
          type: "style",
          file: "src/bar.ts",
          title: "Naming",
          details: "Rename this",
        },
        {
          id: "f3",
          severity: "nit",
          type: "style",
          file: "src/bar.ts",
          title: "Nit",
          details: "Minor",
        },
      ],
    });

    await agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.reviewId).toBe("review-42");
    expect(payload?.blockerCount).toBe(1);
    expect(payload?.importantCount).toBe(1);
    expect(payload?.totalFindings).toBe(3);
  });

  it("propagates an error thrown by the agent runner without persisting any artifact", async () => {
    const agentRunner = {
      run: vi.fn().mockRejectedValue(new Error("model call failed")),
    };
    const artifactRepo = {
      create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
      findByRunId: vi.fn(),
      findLatestByType: vi.fn(),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

    await expect(
      agent.run(makePlan(), makeReport(), "diff", makeTaskBundle(), "run-1"),
    ).rejects.toThrow("model call failed");

    expect(artifactRepo.create).not.toHaveBeenCalled();
  });
});
