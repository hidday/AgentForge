import { describe, it, expect, vi } from "vitest";
import { ReviewerAgent } from "../../src/agents/reviewerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
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
    ...overrides,
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
    scoreRationale: "Solid implementation.",
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
    summary: "Looks good overall.",
    findings: [
      {
        id: "f1",
        severity: "blocker",
        type: "bug",
        file: "src/foo.ts",
        lineHint: 12,
        title: "Missing null check",
        details: "Will throw if foo is null",
      },
      {
        id: "f2",
        severity: "important",
        type: "bug",
        file: "src/bar.ts",
        title: "Off-by-one",
        details: "Loop runs one extra time",
      },
      {
        id: "f3",
        severity: "nit",
        type: "style",
        file: "src/baz.ts",
        title: "Naming",
        details: "Prefer camelCase",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function buildAgent(reviewOverride?: Review) {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";
  let capturedRunOpts: { workingDirectory?: string; timeoutMs?: number; runId?: string } = {};

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        _runtime: unknown,
        opts: {
          prompt: string;
          systemPrompt: string;
          workingDirectory: string;
          timeoutMs: number;
          runId: string;
        },
      ) => {
        capturedSystemPrompt = opts.systemPrompt;
        capturedUserPrompt = opts.prompt;
        capturedRunOpts = opts;
        return {
          raw: "raw reviewer transcript",
          parsed: {
            stage: "reviewer" as const,
            payload: reviewOverride ?? makeReview(),
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
    getRunOpts: () => capturedRunOpts,
  };
}

describe("ReviewerAgent.run()", () => {
  it("renders the system/user prompts from the reviewer templates with the given context", async () => {
    const { agent, getSystemPrompt, getUserPrompt } = buildAgent();
    const taskBundle = makeTaskBundle();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/x b/x", taskBundle, "run-1");

    const systemPrompt = getSystemPrompt();
    const userPrompt = getUserPrompt();
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(userPrompt.length).toBeGreaterThan(0);
    // No unrendered template placeholders should remain for the fields we passed.
    expect(userPrompt).not.toContain("{{diff}}");
  });

  it("routes to the reviewer stage/runtime with the task bundle's repo path and timeout", async () => {
    const { agent, agentRunner, getRunOpts } = buildAgent();
    const taskBundle = makeTaskBundle({
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/lin-1",
        repoPath: "/tmp/custom-repo-path",
        allowedPaths: ["src/"],
        protectedPaths: [],
      },
    });

    await agent.run(makePlan(), makeExecutionReport(), "diff", taskBundle, "run-42");

    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    const [runtime, , stage, schema] = agentRunner.run.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      unknown,
    ];
    expect(stage).toBe("reviewer");
    expect(schema).toBeDefined();
    expect(runtime).toBeDefined();

    const opts = getRunOpts();
    expect(opts.workingDirectory).toBe("/tmp/custom-repo-path");
    expect(opts.runId).toBe("run-42");
  });

  it("persists a ReviewerTranscript artifact with the raw CLI output", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      runId: string;
      type: string;
      version: number;
      rawText: string;
    }[];
    const transcript = calls.find((a) => a.type === "ReviewerTranscript");
    expect(transcript).toBeDefined();
    expect(transcript?.runId).toBe("run-1");
    expect(transcript?.version).toBe(3);
    expect(transcript?.rawText).toBe("raw reviewer transcript");
  });

  it("persists a Review artifact containing the parsed review payload", async () => {
    const review = makeReview({ reviewId: "rev-custom" });
    const { agent, artifactRepo } = buildAgent(review);

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    }[];
    const reviewArtifact = calls.find((a) => a.type === "Review");
    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact?.version).toBe(1);
    expect((reviewArtifact?.payloadJson as Review).reviewId).toBe("rev-custom");
    expect(JSON.parse(reviewArtifact?.rawText ?? "{}")).toEqual(review);
  });

  it("returns the parsed review and logs blocker/important finding counts", async () => {
    const { agent, logger } = buildAgent();

    const result = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff",
      makeTaskBundle(),
      "run-1",
    );

    expect(result.reviewId).toBe("rev-001");
    expect(result.overallVerdict).toBe("changes_requested");
    expect(result.findings).toHaveLength(3);

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.blockerCount).toBe(1);
    expect(payload?.importantCount).toBe(1);
    expect(payload?.totalFindings).toBe(3);
    expect(payload?.verdict).toBe("changes_requested");
  });

  it("reports zero blocker/important counts when the review has no findings", async () => {
    const emptyReview = makeReview({ findings: [], overallVerdict: "approved" });
    const { agent, logger } = buildAgent(emptyReview);

    const result = await agent.run(
      makePlan(),
      makeExecutionReport(),
      "diff",
      makeTaskBundle(),
      "run-1",
    );

    expect(result.findings).toEqual([]);
    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.blockerCount).toBe(0);
    expect(payload?.importantCount).toBe(0);
  });
});
