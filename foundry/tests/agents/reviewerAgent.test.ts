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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
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
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
    summary: "Looks mostly good.",
    findings: [
      {
        id: "f1",
        severity: "blocker",
        type: "bug",
        file: "src/foo.ts",
        lineHint: 10,
        title: "Null pointer risk",
        details: "Will crash on empty input",
      },
      {
        id: "f2",
        severity: "important",
        type: "bug",
        file: "src/foo.ts",
        title: "Missing error handling",
        details: "Unhandled promise rejection",
      },
      {
        id: "f3",
        severity: "nit",
        type: "style",
        file: "src/foo.ts",
        title: "Inconsistent naming",
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

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (_runtime: unknown, opts: { prompt: string; systemPrompt: string }) => {
        capturedSystemPrompt = opts.systemPrompt;
        capturedUserPrompt = opts.prompt;
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
  };
}

describe("ReviewerAgent.run()", () => {
  it("renders the plan, execution report and diff into the prompts", async () => {
    const { agent, getUserPrompt } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff --git a/foo.ts", makeTaskBundle(), "run-1");

    const userPrompt = getUserPrompt();
    expect(userPrompt).not.toContain("{{diff}}");
    expect(userPrompt).not.toContain("{{plan}}");
    expect(userPrompt).not.toContain("{{executionReport}}");
  });

  it("calls the agentRunner with the reviewer stage and codex runtime", async () => {
    const { agent, agentRunner } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "some diff", makeTaskBundle(), "run-1");

    expect(agentRunner.run).toHaveBeenCalledTimes(1);
    const [runtime, input, stageName] = agentRunner.run.mock.calls[0]!;
    expect(runtime).toBe("codex");
    expect(stageName).toBe("reviewer");
    expect((input as { workingDirectory: string }).workingDirectory).toBe("/tmp/repo");
    expect((input as { runId: string }).runId).toBe("run-1");
  });

  it("writes a ReviewerTranscript artifact and a Review artifact", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]) as {
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    }[];

    const transcript = calls.find((a) => a.type === "ReviewerTranscript");
    expect(transcript).toBeDefined();
    expect(transcript?.version).toBe(3);
    expect(transcript?.rawText).toBe("raw reviewer transcript");

    const reviewArtifact = calls.find((a) => a.type === "Review");
    expect(reviewArtifact).toBeDefined();
    expect(reviewArtifact?.version).toBe(1);
    expect((reviewArtifact?.payloadJson as Review).reviewId).toBe("rev-001");
  });

  it("returns the parsed review payload", async () => {
    const { agent } = buildAgent();

    const review = await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(review.reviewId).toBe("rev-001");
    expect(review.overallVerdict).toBe("changes_requested");
    expect(review.findings).toHaveLength(3);
  });

  it("logs blocker/important finding counts and the verdict on completion", async () => {
    const { agent, logger } = buildAgent();

    await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    expect(completionLog).toBeDefined();
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.reviewId).toBe("rev-001");
    expect(payload?.verdict).toBe("changes_requested");
    expect(payload?.totalFindings).toBe(3);
    expect(payload?.blockerCount).toBe(1);
    expect(payload?.importantCount).toBe(1);
  });

  it("counts zero blockers/important findings when the review has none", async () => {
    const approvedReview = makeReview({
      findings: [
        {
          id: "f1",
          severity: "nit",
          type: "style",
          file: "src/foo.ts",
          title: "Nit only",
          details: "Minor",
        },
      ],
      overallVerdict: "approved",
    });
    const { agent, logger } = buildAgent(approvedReview);

    const result = await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(result.overallVerdict).toBe("approved");
    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Review completed",
    );
    const payload = completionLog?.[0] as Record<string, unknown> | undefined;
    expect(payload?.blockerCount).toBe(0);
    expect(payload?.importantCount).toBe(0);
  });

  it("propagates an error from the agentRunner without writing artifacts", async () => {
    const agentRunner = {
      run: vi.fn().mockRejectedValue(new Error("Codex CLI exited with code 1")),
    };
    const artifactRepo = {
      create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
      findByRunId: vi.fn(),
      findLatestByType: vi.fn(),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

    await expect(
      agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1"),
    ).rejects.toThrow("Codex CLI exited with code 1");

    expect(artifactRepo.create).not.toHaveBeenCalled();
  });
});
