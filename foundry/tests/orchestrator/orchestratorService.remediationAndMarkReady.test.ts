import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
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
    prNumber: 7,
    state: RunState.AddressingReview,
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implementation complete.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.6,
    scoreRationale: "Needs remediation.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Found issues",
    findings: [
      {
        id: "f1",
        severity: "important",
        type: "bug",
        file: "src/foo.ts",
        title: "Bug",
        details: "Needs fixing",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function asArtifact(type: string, version: number, payloadJson: unknown): Artifact {
  return {
    id: `artifact-${type}-${version}`,
    runId: "run-1",
    type: type as Artifact["type"],
    version,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt: new Date(),
  };
}

interface TestStore {
  runState: RunState;
}

function buildDeps(initialRun: Run, store: TestStore) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, state: store.runState }),
    ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, state: newState });
    }),
    update: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, state: store.runState }),
    ),
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
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn() };

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
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    remediationAgent,
    gitService,
    githubSync,
  };
}

describe("OrchestratorService.runRemediation", () => {
  it("throws via assertCanRemediate guard when the run is not in AddressingReview", async () => {
    const initialRun = makeRun({ state: RunState.AIReview });
    const store: TestStore = { runState: RunState.AIReview };
    const { deps, artifactRepo } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Review" ? asArtifact("Review", 1, makeReview()) : null),
    );

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("skips git assertBranch/commitAndPush when the run has no branchName", async () => {
    const initialRun = makeRun({ state: RunState.AddressingReview, branchName: null });
    const store: TestStore = { runState: RunState.AddressingReview };
    const { deps, artifactRepo, remediationAgent, gitService } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const review = makeReview();
    const execReport = makeExecutionReport();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review") return Promise.resolve(asArtifact("Review", 1, review));
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, execReport));
      return Promise.resolve(null);
    });
    remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "Fixed", rationale: "r" }],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2, score: 0.9 }),
    });

    // This run has no PR number override -> markReady at the tail will throw
    // on verdict (same pre-existing property documented in executionScore.test.ts);
    // we only assert the git-skip behaviour here.
    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("does NOT call githubSync when the run has no prNumber, but still posts Linear comments", async () => {
    const initialRun = makeRun({ state: RunState.AddressingReview, prNumber: null });
    const store: TestStore = { runState: RunState.AddressingReview };
    const { deps, artifactRepo, remediationAgent, githubSync, linearClient } = buildDeps(
      initialRun,
      store,
    );
    const svc = new OrchestratorService(deps as never);

    const review = makeReview();
    const execReport = makeExecutionReport();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review") return Promise.resolve(asArtifact("Review", 1, review));
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, execReport));
      return Promise.resolve(null);
    });
    const newExecReport = makeExecutionReport({ executionVersion: 2, score: 0.9 });
    remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "Fixed", rationale: "r" }],
      readyForHumanReview: true,
      executionReport: newExecReport,
    });

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);

    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();

    const execUpdateComment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    const remediationComment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Remediation Summary"),
    );
    expect(execUpdateComment).toBeDefined();
    expect(remediationComment).toBeDefined();
  });

  it("posts GitHub updates (execution report + resolutions with the comment map) when prNumber is set", async () => {
    const initialRun = makeRun({ state: RunState.AddressingReview, prNumber: 7 });
    const store: TestStore = { runState: RunState.AddressingReview };
    const { deps, artifactRepo, remediationAgent, githubSync } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const review = makeReview();
    const execReport = makeExecutionReport();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review") return Promise.resolve(asArtifact("Review", 1, review));
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, execReport));
      return Promise.resolve(null);
    });
    const newExecReport = makeExecutionReport({ executionVersion: 2, score: 0.9 });
    const resolution = [{ findingId: "f1", status: "accepted" as const, action: "Fixed", rationale: "r" }];
    remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution,
      readyForHumanReview: true,
      executionReport: newExecReport,
    });

    const commentMap = { f1: 999 };
    await expect(svc.runRemediation("run-1", commentMap)).rejects.toThrow(PolicyViolationError);

    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      7,
      newExecReport,
    );
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      7,
      resolution,
      commentMap,
    );
  });

  it("completes the full happy path through markReady when the latest Review is already approved by the time it re-checks", async () => {
    // assertCanRemediate (at the top of runRemediation) requires the latest
    // Review to be "changes_requested"; markReady (at the tail) requires it
    // to be "approved". In this fake, a human/process has already superseded
    // the Review with an approved one between those two reads (e.g. a
    // concurrent re-review), so both checks pass and the run actually reaches
    // ReadyForHumanReview end-to-end.
    const initialRun = makeRun({ state: RunState.AddressingReview, prNumber: 7 });
    const store: TestStore = { runState: RunState.AddressingReview };
    const { deps, artifactRepo, remediationAgent } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const changesRequestedReview = makeReview({ overallVerdict: "changes_requested" });
    const approvedReview = makeReview({ overallVerdict: "approved", findings: [] });
    let reviewReadCount = 0;
    const execReport = makeExecutionReport();
    const newExecReport = makeExecutionReport({ executionVersion: 2, score: 0.9 });

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review") {
        reviewReadCount += 1;
        return Promise.resolve(
          asArtifact("Review", 1, reviewReadCount === 1 ? changesRequestedReview : approvedReview),
        );
      }
      if (type === "ExecutionReport") {
        return Promise.resolve(asArtifact("ExecutionReport", reviewReadCount, execReport));
      }
      return Promise.resolve(null);
    });
    remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "Fixed", rationale: "r" }],
      readyForHumanReview: true,
      executionReport: newExecReport,
    });

    const result = await svc.runRemediation("run-1");

    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });
});

describe("OrchestratorService.markReady", () => {
  it("posts the completion comment and returns the run when all policy checks pass", async () => {
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: 7 });
    const store: TestStore = { runState: RunState.AIReview };
    const { deps, artifactRepo, linearClient } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review")
        return Promise.resolve(
          asArtifact("Review", 1, makeReview({ overallVerdict: "approved", findings: [] })),
        );
      if (type === "ExecutionReport")
        return Promise.resolve(asArtifact("ExecutionReport", 1, makeExecutionReport()));
      return Promise.resolve(null);
    });

    const result = await svc.markReady("run-1");

    expect(result).toBeDefined();
    const readyComment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Ready for Human Review"),
    );
    expect(readyComment).toBeDefined();
  });

  it("propagates the PolicyViolationError from assertCanMarkReady without posting a comment", async () => {
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: null });
    const store: TestStore = { runState: RunState.AIReview };
    const { deps, artifactRepo, linearClient } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.markReady("run-1")).rejects.toThrow(PolicyViolationError);
    expect(linearClient.postComment).not.toHaveBeenCalled();
  });
});
