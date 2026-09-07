import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/lin-1",
    prNumber: 42,
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

function makePlan(): Plan {
  return {
    planVersion: 1,
    summary: "Test plan",
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
    summary: "Did the work",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "" },
      typecheck: { status: "pass", details: "" },
      tests: { status: "pass", details: "" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "solid",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "review-1",
    summary: "Looks good",
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
      title: "Title",
      description: "desc",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    }),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };
  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff --git a/x b/x"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };
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
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };
  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn().mockResolvedValue(makeReview()) };
  const remediationAgent = {
    run: vi.fn().mockResolvedValue({
      reviewId: "review-1",
      resolution: [],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2, score: 0.95 }),
    }),
  };
  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/worktree"),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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
    eventRepo,
    linearClient,
    githubClient,
    githubSync,
    gitService,
    reviewerAgent,
    remediationAgent,
    logger,
  };
}

describe("OrchestratorService.runReview", () => {
  it("throws when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runReview("missing")).rejects.toThrow("Run not found: missing");
  });

  it("on an approved verdict: transitions to REVIEW_APPROVED and calls markReady", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent } = buildDeps();
    const run = makeRun({ state: RunState.AIReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockImplementation((_id: string, state: RunState) =>
      Promise.resolve(makeRun({ state })),
    );
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: makeReview() }));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(run);

    const result = await svc.runReview("run-1");

    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(result).toBeDefined();
  });

  it("on a changes_requested verdict: posts a comment, transitions, and delegates to runRemediation", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, linearClient, githubSync } = buildDeps();
    const run = makeRun({ state: RunState.AIReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockImplementation((_id: string, state: RunState) =>
      Promise.resolve(makeRun({ state })),
    );
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
      ],
    });
    reviewerAgent.run.mockResolvedValue(review);
    const svc = new OrchestratorService(deps as never);
    const runRemediationSpy = vi.spyOn(svc, "runRemediation").mockResolvedValue(run);

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      42,
      review.findings,
      "changes_requested",
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Changes Requested"),
    );
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", expect.any(Object));
  });

  it("fetches the PR diff and passes it to the reviewer agent when the run has a PR", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubClient } = buildDeps();
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockImplementation((_id: string, state: RunState) =>
      Promise.resolve(makeRun({ state, prNumber: 42 })),
    );
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(run);

    await svc.runReview("run-1");

    expect(githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 42);
    const reviewerCallArgs = reviewerAgent.run.mock.calls[0];
    expect(reviewerCallArgs[2]).toBe("diff --git a/x b/x");
  });
});

describe("OrchestratorService.runRemediation", () => {
  it("throws when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runRemediation("missing")).rejects.toThrow("Run not found: missing");
  });

  it("asserts branch, runs the remediation agent, commits, and posts execution report + resolutions to GitHub", async () => {
    const { deps, runRepo, artifactRepo, gitService, remediationAgent, linearClient, githubSync } =
      buildDeps();
    const run = makeRun({ state: RunState.AddressingReview, branchName: "ai/lin-1", prNumber: 42 });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockImplementation((_id: string, state: RunState) =>
      Promise.resolve(makeRun({ state, branchName: "ai/lin-1", prNumber: 42 })),
    );
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: makeReview({ overallVerdict: "changes_requested", findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }] }) }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(run);

    await svc.runRemediation("run-1", { f1: 500 });

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/lin-1");
    expect(remediationAgent.run).toHaveBeenCalled();
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/lin-1",
      expect.stringContaining("Remediation"),
    );
    expect(linearClient.postComment).toHaveBeenCalledTimes(2);
    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.objectContaining({ executionVersion: 2 }),
    );
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      [],
      { f1: 500 },
    );
  });

  it("skips git operations when the run has no branchName", async () => {
    const { deps, runRepo, artifactRepo, gitService } = buildDeps();
    const run = makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: null });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockImplementation((_id: string, state: RunState) =>
      Promise.resolve(makeRun({ state, branchName: null, prNumber: null })),
    );
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: makeReview({ overallVerdict: "changes_requested", findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }] }) }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(run);

    await svc.runRemediation("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("skips GitHub PR updates when the run has no prNumber", async () => {
    const { deps, runRepo, artifactRepo, githubSync } = buildDeps();
    const run = makeRun({ state: RunState.AddressingReview, branchName: "ai/lin-1", prNumber: null });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockImplementation((_id: string, state: RunState) =>
      Promise.resolve(makeRun({ state, branchName: "ai/lin-1", prNumber: null })),
    );
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: makeReview({ overallVerdict: "changes_requested", findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }] }) }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(run);

    await svc.runRemediation("run-1");

    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });
});
