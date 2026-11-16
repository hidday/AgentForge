import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import { PolicyViolationError } from "../../src/utils/errors.js";

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
    state: RunState.AddressingReview,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: "claude-code",
    reviewerRuntime: "codex",
    remediationRuntime: null,
    workingDirectory: "/tmp/worktree",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "pass", details: "all green" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.7,
    scoreRationale: "needs work",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Needs fixes",
    findings: [
      {
        id: "f1",
        severity: "blocker",
        type: "bug",
        file: "src/a.ts",
        title: "Null deref",
        details: "a.b can be null",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Review",
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
    update: vi.fn(),
    updateState: vi.fn(),
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
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
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
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubSync,
    gitService,
    remediationAgent,
    logger,
  };
}

describe("OrchestratorService.runRemediation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws PolicyViolationError when the run is not in AddressingReview state", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Review" ? Promise.resolve(makeArtifact({ payloadJson: makeReview() })) : null,
    );

    const svc = new OrchestratorService(deps as never);
    const err = await svc.runRemediation("run-1").catch((e) => e);

    expect(err).toBeInstanceOf(PolicyViolationError);
    expect((err as PolicyViolationError).rule).toBe("remediate_requires_addressing_review_state");
  });

  it("throws PolicyViolationError when the review has no findings", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Review"
        ? Promise.resolve(makeArtifact({ payloadJson: makeReview({ findings: [] }) }))
        : null,
    );

    const svc = new OrchestratorService(deps as never);
    const err = await svc.runRemediation("run-1").catch((e) => e);

    expect(err).toBeInstanceOf(PolicyViolationError);
    expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
  });

  it("asserts the branch and commits+pushes when run.branchName is set", async () => {
    const { deps, runRepo, artifactRepo, gitService, remediationAgent } = buildDeps();
    runRepo.findById.mockResolvedValue(
      makeRun({ state: RunState.AddressingReview, branchName: "ai/run-1", prNumber: null }),
    );
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ payloadJson: makeReview() }));
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });
    remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "fixed it", rationale: "good" }],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2, score: 0.95 }),
    });
    runRepo.update.mockResolvedValue(
      makeRun({ state: RunState.AddressingReview, branchName: "ai/run-1", prNumber: null }),
    );
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: null }))
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: null }));

    const svc = new OrchestratorService(deps as never);
    const err = await svc.runRemediation("run-1").catch((e) => e);

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      "[AI] Remediation: address review findings",
    );
    // markReady will throw (no prNumber) -- that's fine, we're asserting the git calls above.
    expect(err).toBeInstanceOf(PolicyViolationError);
  });

  it("skips branch assertion/commit when run.branchName is not set, and skips github sync calls when there is no PR", async () => {
    const { deps, runRepo, artifactRepo, gitService, githubSync, remediationAgent, linearClient } =
      buildDeps();
    runRepo.findById.mockResolvedValue(
      makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: null }),
    );
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ payloadJson: makeReview() }));
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });
    remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "fixed it", rationale: "good" }],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2, score: 0.95 }),
    });
    runRepo.update.mockResolvedValue(
      makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: null }),
    );
    runRepo.updateState.mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: null }));

    const svc = new OrchestratorService(deps as never);
    await svc.runRemediation("run-1").catch((e) => e);

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Execution Report"),
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Remediation Summary"),
    );
  });

  it("posts the execution report update and remediation resolutions to GitHub when there is a PR", async () => {
    const { deps, runRepo, artifactRepo, githubSync, remediationAgent } = buildDeps();
    runRepo.findById.mockResolvedValue(
      makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: 42 }),
    );
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ payloadJson: makeReview() }));
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });
    const newExecutionReport = makeExecutionReport({ executionVersion: 2, score: 0.95 });
    remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "fixed it", rationale: "good" }],
      readyForHumanReview: true,
      executionReport: newExecutionReport,
    });
    runRepo.update.mockResolvedValue(
      makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: 42 }),
    );
    runRepo.updateState.mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 42 }));

    const svc = new OrchestratorService(deps as never);
    await svc.runRemediation("run-1", { f1: 99 }).catch((e) => e);

    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      42,
      newExecutionReport,
    );
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      [{ findingId: "f1", status: "accepted", action: "fixed it", rationale: "good" }],
      { f1: 99 },
    );
  });
});

describe("OrchestratorService.markReady", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts the completion comment and returns the run when all checks pass and the review is approved", async () => {
    const { deps, runRepo, artifactRepo, linearClient, logger } = buildDeps();
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({
            payloadJson: { reviewId: "rev-1", summary: "fine", findings: [], overallVerdict: "approved" },
          }),
        );
      if (type === "ExecutionReport")
        return Promise.resolve(
          makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport({ score: 1 }) }),
        );
      return Promise.resolve(null);
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.markReady("run-1");

    expect(result).toEqual(run);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
    expect(logger.info).toHaveBeenCalledWith(
      { runId: "run-1", state: run.state },
      "Run marked as ready for human review",
    );
  });

  it("throws PolicyViolationError without posting a comment when there are unresolved blocker findings", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 42 }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({
            payloadJson: {
              reviewId: "rev-1",
              summary: "fine",
              findings: [
                { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "x", details: "y" },
              ],
              overallVerdict: "approved",
            },
          }),
        );
      if (type === "ExecutionReport")
        return Promise.resolve(
          makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport({ score: 1 }) }),
        );
      return Promise.resolve(null);
    });

    const svc = new OrchestratorService(deps as never);
    const err = await svc.markReady("run-1").catch((e) => e);

    expect(err).toBeInstanceOf(PolicyViolationError);
    expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
    expect(linearClient.postComment).not.toHaveBeenCalled();
  });

  it("throws PolicyViolationError when there is no PR number", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: null }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    const svc = new OrchestratorService(deps as never);
    const err = await svc.markReady("run-1").catch((e) => e);

    expect(err).toBeInstanceOf(PolicyViolationError);
    expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
  });
});
