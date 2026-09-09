import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { Remediation } from "../../src/schemas/remediation.js";

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
    summary: "Implementation done.",
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
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Found issues",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeRemediation(overrides: Partial<Remediation> = {}): Remediation {
  return {
    reviewId: "rev-1",
    resolution: [
      { findingId: "f1", status: "accepted", action: "Fixed", rationale: "Confirmed bug" },
    ],
    readyForHumanReview: true,
    executionReport: makeExecutionReport({ executionVersion: 2, score: 0.95 }),
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

function buildDeps() {
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
    findLatestByType: vi.fn(),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff content"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(null),
    getDefaultRepo: vi.fn().mockReturnValue({
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
    },
    runRepo,
    artifactRepo,
    eventRepo,
    reviewerAgent,
    remediationAgent,
    githubClient,
    githubSync,
    linearClient,
    gitService,
    logger,
  };
}

describe("OrchestratorService.runReview", () => {
  it("fetches the PR diff when a PR exists, posts findings, and moves to remediation on changes_requested", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubClient, githubSync, linearClient } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ prNumber: 42, state: RunState.AIReview });
    const changesRequestedRun = makeRun({ state: RunState.AddressingReview });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(changesRequestedRun);
    reviewerAgent.run.mockResolvedValue(
      makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
        ],
      }),
    );
    const runRemediationSpy = vi.spyOn(svc, "runRemediation").mockResolvedValue(changesRequestedRun);

    const result = await svc.runReview("run-1");

    expect(githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 42);
    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.any(Array),
      "changes_requested",
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("AI Code Review"),
    );
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", { f1: 123 });
    expect(result).toBe(changesRequestedRun);
  });

  it("skips posting review findings when there are none, even with a PR present", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubClient, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ prNumber: 42, state: RunState.AIReview });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved", findings: [] }));
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    expect(githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 42);
    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
  });

  it("moves to ReadyForHumanReview via markReady when the verdict is approved", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ prNumber: 42, state: RunState.AIReview });
    const approvedRun = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(approvedRun);
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved", findings: [] }));
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(approvedRun);

    const result = await svc.runReview("run-1");

    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(result).toBe(approvedRun);
  });

  it("does not post review findings when the verdict is changes_requested but there are no findings", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ prNumber: 42, state: RunState.AIReview });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "changes_requested", findings: [] }));
    vi.spyOn(svc, "runRemediation").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
  });

  it("propagates the PolicyViolationError from assertCanReview when there is no ExecutionReport", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ prNumber: 42, state: RunState.AIReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);
  });
});

describe("OrchestratorService.runRemediation", () => {
  it("skips git operations and PR sync when the run has no branch or PR", async () => {
    const { deps, runRepo, artifactRepo, remediationAgent, gitService, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ branchName: null, prNumber: null, state: RunState.AddressingReview });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: makeReview({
              overallVerdict: "changes_requested",
              findings: [
                { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
              ],
            }),
          }),
        );
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });
    remediationAgent.run.mockResolvedValue(makeRemediation());
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(
      makeRun({ state: RunState.AIReview, branchName: null, prNumber: null }),
    );
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runRemediation("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });

  it("commits, pushes, and syncs the PR when the run has both a branch and a PR", async () => {
    const { deps, runRepo, artifactRepo, remediationAgent, gitService, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ branchName: "ai/run-1", prNumber: 42, state: RunState.AddressingReview });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: makeReview({
              overallVerdict: "changes_requested",
              findings: [
                { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
              ],
            }),
          }),
        );
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });
    const remediation = makeRemediation();
    remediationAgent.run.mockResolvedValue(remediation);
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runRemediation("run-1", { f1: 999 });

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("Remediation"),
    );
    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      42,
      remediation.executionReport,
    );
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      remediation.resolution,
      { f1: 999 },
    );
  });

  it("propagates the PolicyViolationError from assertCanRemediate when the review verdict is not changes_requested", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review")
        return Promise.resolve(makeArtifact({ type: "Review", payloadJson: makeReview({ overallVerdict: "approved" }) }));
      return Promise.resolve(null);
    });

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);
  });
});

describe("OrchestratorService.markReady", () => {
  it("posts the completion comment and returns the run when policy checks pass", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ prNumber: 42, state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review")
        return Promise.resolve(makeArtifact({ type: "Review", payloadJson: makeReview({ overallVerdict: "approved" }) }));
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });

    const result = await svc.markReady("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Ready for Human Review"),
    );
    expect(result).toBe(run);
  });

  it("throws when policy checks fail (e.g. missing review)", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ prNumber: 42 }));
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });

    await expect(svc.markReady("run-1")).rejects.toThrow(PolicyViolationError);
  });
});
