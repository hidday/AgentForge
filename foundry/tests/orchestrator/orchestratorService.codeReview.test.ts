import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: 5,
    state: RunState.AIReview,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/worktree",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
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
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Did the thing",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Solid",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Looks OK",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn().mockResolvedValue("diff --git a/src/a.ts") };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    }),
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn().mockResolvedValue(new Map([["f1", 123]])),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
  };

  return {
    deps: {
      runRepo,
      artifactRepo,
      eventRepo,
      linearClient,
      githubClient,
      gitService,
      repoRegistry,
      linearSync,
      githubSync,
      plannerAgent,
      planReviewerAgent,
      planReviserAgent,
      executorAgent,
      reviewerAgent,
      remediationAgent,
      logger,
      dashboardEmitter,
      ...overrides,
    },
    runRepo,
    artifactRepo,
    linearClient,
    githubClient,
    githubSync,
    reviewerAgent,
    remediationAgent,
  };
}

describe("OrchestratorService.runReview", () => {
  it("approved verdict with zero findings: skips postReviewFindings, transitions to ReadyForHumanReview via markReady", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    const execReport = makeExecutionReport();
    const review = makeReview({ overallVerdict: "approved", findings: [] });

    runRepo.findById
      .mockResolvedValueOnce(makeRun({ prNumber: 5 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 5 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 5 }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: execReport }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(review);
    runRepo.update.mockResolvedValue(makeRun({ reviewerRuntime: "codex", prNumber: 5 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 5 }));

    const result = await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("changes_requested verdict with findings and a PR: posts review findings, comments, and chains into remediation", async () => {
    const { deps, runRepo, artifactRepo, linearClient, reviewerAgent, remediationAgent, githubSync } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    const execReport = makeExecutionReport();
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "bug",
          file: "src/a.ts",
          lineHint: 10,
          title: "Off by one",
          details: "Loop bound is wrong",
        },
      ],
    });
    const remediationReport = makeExecutionReport({ executionVersion: 2, score: 0.95 });

    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 5 })) // requireRun in runReview
      .mockResolvedValueOnce(makeRun({ state: RunState.AddressingReview, prNumber: 5 })) // requireRun in runRemediation
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 5 })); // requireRun in markReady
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: execReport }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      // NOTE: the persisted Review artifact is never replaced by the remediation
      // pass (only reviewerAgent writes a "Review" artifact), so it still reads
      // back as "changes_requested" here. This is a pre-existing quirk, not
      // something introduced by this test -- see orchestratorService.executionScore.test.ts
      // for the same documented behavior. markReady is therefore expected to
      // throw on the verdict check below.
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(review);
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 5, reviewerRuntime: "codex" }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AddressingReview, prNumber: 5, remediationRuntime: "claude-code" }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AddressingReview, prNumber: 5 })) // REVIEW_CHANGES_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 5 })); // REMEDIATION_FINISHED
    remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "Fixed", rationale: "Confirmed bug" }],
      readyForHumanReview: true,
      executionReport: remediationReport,
    });

    // markReady (invoked at the tail of runRemediation) throws because the
    // Review artifact's verdict was never re-approved post-remediation --
    // a pre-existing behavior, not something this test is asserting is correct.
    await expect(svc.runReview("run-1")).rejects.toThrow(/Cannot mark ready/);

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      5,
      review.findings,
      "changes_requested",
    );
    expect(remediationAgent.run).toHaveBeenCalled();
    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[1] as string).includes("Off by one"),
    );
    expect(comment).toBeDefined();
  });

  it("throws PolicyViolationError when run is not in AIReview state", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runReview("run-1")).rejects.toThrow(/Cannot review/);
  });

  it("fetches the PR diff via githubClient when the run has a prNumber", async () => {
    const { deps, runRepo, artifactRepo, githubClient, reviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    const execReport = makeExecutionReport();
    const review = makeReview({ overallVerdict: "approved" });

    runRepo.findById
      .mockResolvedValueOnce(makeRun({ prNumber: 5 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 5 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 5 }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: execReport }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(review);
    runRepo.update.mockResolvedValue(makeRun({ reviewerRuntime: "codex", prNumber: 5 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 5 }));

    await svc.runReview("run-1");

    expect(githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 5);
  });
});
