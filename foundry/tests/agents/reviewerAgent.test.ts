import { describe, it, expect, vi } from "vitest";
import { ReviewerAgent } from "../../src/agents/reviewerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review, Finding } from "../../src/schemas/review.js";

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
    requirementsTraceability: "Traceability",
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
    summary: "Implemented the feature",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "pass", details: "clean" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.95,
    scoreRationale: "Looks solid",
  };
}

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    id: "f1",
    severity: "nit",
    type: "style",
    file: "src/foo.ts",
    title: "Title",
    details: "Details",
    ...overrides,
  };
}

function makeReview(findings: Finding[], overallVerdict: Review["overallVerdict"] = "approved"): Review {
  return {
    reviewId: "rev-001",
    summary: "Review summary",
    findings,
    overallVerdict,
  };
}

function buildReviewerAgent(review: Review, raw = "raw reviewer output") {
  let capturedPrompt = "";
  let capturedSystemPrompt = "";
  let capturedRunArgs: unknown[] = [];

  const agentRunner = {
    run: vi.fn().mockImplementation(async (...args: unknown[]) => {
      capturedRunArgs = args;
      const opts = args[1] as { prompt: string; systemPrompt: string };
      capturedPrompt = opts.prompt;
      capturedSystemPrompt = opts.systemPrompt;
      return {
        raw,
        parsed: {
          payload: review,
        },
      };
    }),
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
    getPrompt: () => capturedPrompt,
    getSystemPrompt: () => capturedSystemPrompt,
    getRunArgs: () => capturedRunArgs,
  };
}

describe("ReviewerAgent.run()", () => {
  it("renders the system and user prompts with the merged vars (plan, executionReport, diff, taskBundle)", async () => {
    const review = makeReview([]);
    const { agent, getPrompt, getSystemPrompt, getRunArgs } = buildReviewerAgent(review);

    const taskBundle = makeTaskBundle();
    const plan = makePlan();
    const executionReport = makeExecutionReport();
    const diff = "diff --git a/src/foo.ts b/src/foo.ts\n+added line";

    await agent.run(plan, executionReport, diff, taskBundle, "run-1");

    const prompt = getPrompt();
    const systemPrompt = getSystemPrompt();

    // user template vars
    expect(prompt).toContain(taskBundle.issue.id);
    expect(prompt).toContain(taskBundle.issue.title);
    expect(prompt).toContain(taskBundle.issue.description);
    expect(prompt).toContain(String(plan.planVersion));
    expect(prompt).toContain(plan.summary);
    expect(prompt).toContain(executionReport.summary);
    expect(prompt).toContain("src/foo.ts");
    expect(prompt).toContain("pass");
    expect(prompt).toContain(diff);

    // system template is static but should render without leftover placeholders
    expect(systemPrompt).toContain("senior software engineer acting as a code reviewer");
    expect(systemPrompt).not.toContain("{{");

    // confirm agentRunner.run was called with the correct stage/runtime and working directory
    const [runtime, opts, stage, schema] = getRunArgs() as [
      unknown,
      { workingDirectory: string; runId: string },
      string,
      unknown,
    ];
    expect(stage).toBe("reviewer");
    expect(opts.workingDirectory).toBe(taskBundle.repo.repoPath);
    expect(opts.runId).toBe("run-1");
    expect(runtime).toBeDefined();
    expect(schema).toBeDefined();
  });

  it("persists a ReviewerTranscript artifact with the raw output and a Review artifact with the parsed payload", async () => {
    const review = makeReview([makeFinding({ severity: "blocker" })], "changes_requested");
    const raw = "=== raw cli transcript ===";
    const { agent, artifactRepo } = buildReviewerAgent(review, raw);

    await agent.run(makePlan(), makeExecutionReport(), "some diff", makeTaskBundle(), "run-42");

    expect(artifactRepo.create).toHaveBeenCalledTimes(2);

    expect(artifactRepo.create).toHaveBeenNthCalledWith(1, {
      runId: "run-42",
      type: "ReviewerTranscript",
      version: 3,
      payloadJson: {},
      rawText: raw,
    });

    expect(artifactRepo.create).toHaveBeenNthCalledWith(2, {
      runId: "run-42",
      type: "Review",
      version: 1,
      payloadJson: review as unknown as object,
      rawText: JSON.stringify(review, null, 2),
    });
  });

  it("returns the parsed Review value", async () => {
    const review = makeReview([makeFinding({ severity: "important" })]);
    const { agent } = buildReviewerAgent(review);

    const result = await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

    expect(result).toBe(review);
  });

  describe("blockerCount / importantCount log aggregation", () => {
    it("logs zero counts when there are no findings", async () => {
      const review = makeReview([]);
      const { agent, logger } = buildReviewerAgent(review);

      await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

      expect(logger.info).toHaveBeenCalledWith(
        {
          runId: "run-1",
          reviewId: review.reviewId,
          verdict: review.overallVerdict,
          totalFindings: 0,
          blockerCount: 0,
          importantCount: 0,
        },
        "Review completed",
      );
    });

    it("counts only blockers when all findings are blockers", async () => {
      const findings = [
        makeFinding({ id: "f1", severity: "blocker" }),
        makeFinding({ id: "f2", severity: "blocker" }),
      ];
      const review = makeReview(findings, "changes_requested");
      const { agent, logger } = buildReviewerAgent(review);

      await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

      expect(logger.info).toHaveBeenCalledWith(
        {
          runId: "run-1",
          reviewId: review.reviewId,
          verdict: review.overallVerdict,
          totalFindings: 2,
          blockerCount: 2,
          importantCount: 0,
        },
        "Review completed",
      );
    });

    it("counts only important findings when all findings are important", async () => {
      const findings = [
        makeFinding({ id: "f1", severity: "important" }),
        makeFinding({ id: "f2", severity: "important" }),
        makeFinding({ id: "f3", severity: "important" }),
      ];
      const review = makeReview(findings, "changes_requested");
      const { agent, logger } = buildReviewerAgent(review);

      await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

      expect(logger.info).toHaveBeenCalledWith(
        {
          runId: "run-1",
          reviewId: review.reviewId,
          verdict: review.overallVerdict,
          totalFindings: 3,
          blockerCount: 0,
          importantCount: 3,
        },
        "Review completed",
      );
    });

    it("counts a mix of blocker, important, and other severities independently", async () => {
      const findings = [
        makeFinding({ id: "f1", severity: "blocker" }),
        makeFinding({ id: "f2", severity: "important" }),
        makeFinding({ id: "f3", severity: "suggestion" }),
        makeFinding({ id: "f4", severity: "nit" }),
        makeFinding({ id: "f5", severity: "blocker" }),
      ];
      const review = makeReview(findings, "changes_requested");
      const { agent, logger } = buildReviewerAgent(review);

      await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

      expect(logger.info).toHaveBeenCalledWith(
        {
          runId: "run-1",
          reviewId: review.reviewId,
          verdict: review.overallVerdict,
          totalFindings: 5,
          blockerCount: 2,
          importantCount: 1,
        },
        "Review completed",
      );
    });

    it("does not count severities that are neither blocker nor important", async () => {
      const findings = [
        makeFinding({ id: "f1", severity: "suggestion" }),
        makeFinding({ id: "f2", severity: "nit" }),
        makeFinding({ id: "f3", severity: "nit" }),
      ];
      const review = makeReview(findings, "approved");
      const { agent, logger } = buildReviewerAgent(review);

      await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-1");

      expect(logger.info).toHaveBeenCalledWith(
        {
          runId: "run-1",
          reviewId: review.reviewId,
          verdict: review.overallVerdict,
          totalFindings: 3,
          blockerCount: 0,
          importantCount: 0,
        },
        "Review completed",
      );
    });

    it("logs the start message before running", async () => {
      const review = makeReview([]);
      const { agent, logger } = buildReviewerAgent(review);

      await agent.run(makePlan(), makeExecutionReport(), "diff", makeTaskBundle(), "run-77");

      expect(logger.info).toHaveBeenNthCalledWith(
        1,
        { runId: "run-77" },
        "Starting reviewer agent (Codex CLI)",
      );
    });
  });
});
