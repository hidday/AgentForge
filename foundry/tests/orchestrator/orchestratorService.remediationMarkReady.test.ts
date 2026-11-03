import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
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
    prNumber: 5,
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
    summary: "Implemented the feature.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.6,
    scoreRationale: "Needs work.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Found an issue",
    findings: [{ id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "oops" }],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function makeRemediation(newReport: ExecutionReport, overrides: Partial<Remediation> = {}): Remediation {
  return {
    reviewId: "rev-1",
    resolution: [{ findingId: "f1", status: "accepted", action: "Fixed bug", rationale: "Was real" }],
    readyForHumanReview: true,
    executionReport: newReport,
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
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
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
    eventRepo,
    linearClient,
    gitService,
    remediationAgent,
    githubSync,
  };
}

describe("OrchestratorService.runRemediation", () => {
  it("throws when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(null);

    await expect(svc.runRemediation("missing-run")).rejects.toThrow("Run not found: missing-run");
  });

  it("throws PolicyViolationError when run is not in AddressingReview state", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: makeReview() }));
      return Promise.resolve(null);
    });

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runRemediation("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("remediate_requires_addressing_review_state");
  });

  it("throws PolicyViolationError when the review verdict is not changes_requested", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review") {
        return Promise.resolve(
          makeArtifact({ type: "Review", payloadJson: makeReview({ overallVerdict: "approved" }) }),
        );
      }
      return Promise.resolve(null);
    });

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runRemediation("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("remediate_requires_changes_requested_verdict");
  });

  it("throws PolicyViolationError when there are no review findings", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: makeReview({ findings: [] }) }));
      return Promise.resolve(null);
    });

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runRemediation("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("remediate_requires_findings");
  });

  // NOTE: assertCanMarkReady (invoked at the end of runRemediation) requires the
  // *latest* Review artifact to have verdict "approved". Since these mocks keep
  // returning the original "changes_requested" Review (the real ReviewerAgent
  // would need to run again to produce an approved one, which is outside
  // runRemediation's own responsibility), markReady throws here. This mirrors
  // the documented pre-existing behaviour exercised in
  // orchestratorService.executionScore.test.ts. We assert on the remediation
  // side effects that DO happen before that throw.
  it("happy path: commits remediation changes, posts comments and GitHub updates, then surfaces markReady's policy check", async () => {
    const { deps, runRepo, artifactRepo, gitService, remediationAgent, linearClient, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const addressingRun = makeRun({ state: RunState.AddressingReview });
    const aiReviewRun = makeRun({ state: RunState.AIReview });

    runRepo.findById.mockResolvedValueOnce(addressingRun).mockResolvedValue(aiReviewRun);
    runRepo.update.mockResolvedValue({ ...addressingRun, remediationRuntime: "claude-code" });
    runRepo.updateState.mockResolvedValueOnce(aiReviewRun); // REMEDIATION_FINISHED

    const review = makeReview();
    const oldReport = makeExecutionReport({ executionVersion: 1 });
    const newReport = makeExecutionReport({ executionVersion: 2, score: 0.95, scoreRationale: "Fixed." });
    const remediation = makeRemediation(newReport);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: oldReport }));
      return Promise.resolve(null);
    });
    remediationAgent.run.mockResolvedValue(remediation);

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runRemediation("run-1", { f1: 55 });
    } catch (err) {
      caught = err as PolicyViolationError;
    }

    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("ready_requires_approved_verdict");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(remediationAgent.run).toHaveBeenCalledWith(review, oldReport, "/tmp/worktree", "run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      "[AI] Remediation: address review findings",
    );
    expect(linearClient.postComment).toHaveBeenCalledWith("LIN-1", expect.stringContaining("Execution Report"));
    expect(linearClient.postComment).toHaveBeenCalledWith("LIN-1", expect.stringContaining("Remediation Summary"));
    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith("test-repo", 5, newReport);
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      5,
      remediation.resolution,
      { f1: 55 },
    );
  });

  it("does not touch git or GitHub when the run has no branchName/prNumber", async () => {
    const { deps, runRepo, artifactRepo, gitService, remediationAgent, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const addressingRun = makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: null });
    const aiReviewRun = makeRun({ state: RunState.AIReview, branchName: null, prNumber: null });

    runRepo.findById.mockResolvedValueOnce(addressingRun).mockResolvedValue(aiReviewRun);
    runRepo.update.mockResolvedValue({ ...addressingRun, remediationRuntime: "claude-code" });
    runRepo.updateState.mockResolvedValueOnce(aiReviewRun);

    const review = makeReview();
    const oldReport = makeExecutionReport({ executionVersion: 1 });
    const newReport = makeExecutionReport({ executionVersion: 2 });
    const remediation = makeRemediation(newReport);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: oldReport }));
      return Promise.resolve(null);
    });
    remediationAgent.run.mockResolvedValue(remediation);

    // markReady throws (no PR) -- expected, see note above; we only care about
    // the branches gated on run.branchName / run.prNumber here.
    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.markReady", () => {
  it("throws when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(null);

    await expect(svc.markReady("missing-run")).rejects.toThrow("Run not found: missing-run");
  });

  it("throws PolicyViolationError when there's no PR", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ prNumber: null }));

    let caught: PolicyViolationError | undefined;
    try {
      await svc.markReady("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("ready_requires_pr");
  });

  it("throws PolicyViolationError when there are unresolved blocker findings", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun());

    const report = makeExecutionReport();
    const review = makeReview({
      overallVerdict: "approved",
      findings: [{ id: "f1", severity: "blocker", type: "bug", file: "src/foo.ts", title: "Bad", details: "d" }],
    });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: report }));
      return Promise.resolve(null);
    });

    let caught: PolicyViolationError | undefined;
    try {
      await svc.markReady("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("ready_requires_blockers_resolved");
  });

  it("happy path: posts the final 'Ready for Human Review' Linear comment", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const readyRun = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(readyRun);

    const report = makeExecutionReport();
    const review = makeReview({ overallVerdict: "approved" });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: report }));
      return Promise.resolve(null);
    });

    const result = await svc.markReady("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
    expect(result).toBe(readyRun);
  });
});
