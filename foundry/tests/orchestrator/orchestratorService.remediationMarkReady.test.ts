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
    prNumber: 77,
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
    summary: "Implemented",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "fail", details: "one failing" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.6,
    scoreRationale: "Needs work",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Found a bug",
    findings: [
      { id: "f1", severity: "important", type: "bug", file: "src/a.ts", title: "Bug", details: "x" },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function makeRemediation(newReport: ExecutionReport): Remediation {
  return {
    reviewId: "rev-1",
    resolution: [
      { findingId: "f1", status: "accepted", action: "Fixed it", rationale: "Was a real bug" },
    ],
    readyForHumanReview: true,
    executionReport: newReport,
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

function buildDeps(overrides: { run?: Run } = {}) {
  const run = overrides.run ?? makeRun();
  const review = makeReview();
  const executionReport = makeExecutionReport();
  const newReport = makeExecutionReport({
    executionVersion: 2,
    score: 0.95,
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "all green" },
    },
  });
  const remediation = makeRemediation(newReport);

  const reviewArtifact = makeArtifact({ type: "Review", version: 1, payloadJson: review });
  const execArtifact = makeArtifact({
    type: "ExecutionReport",
    version: 1,
    payloadJson: executionReport,
  });

  const runRepo = {
    findById: vi.fn().mockResolvedValue(run),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, state: RunState) =>
      Promise.resolve({ ...run, state }),
    ),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) =>
      Promise.resolve({ ...run, ...patch }),
    ),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      if (type === "Review") return Promise.resolve(reviewArtifact);
      if (type === "ExecutionReport") return Promise.resolve(execArtifact);
      return Promise.resolve(null);
    }),
  };

  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
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
  const remediationAgent = { run: vi.fn().mockResolvedValue(remediation) };

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
    },
    run,
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubSync,
    gitService,
    remediationAgent,
  };
}

describe("OrchestratorService.runRemediation", () => {
  it("throws via policy when the run is not AddressingReview", async () => {
    const { deps } = buildDeps({ run: makeRun({ state: RunState.AIReview }) });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
  });

  it("asserts the branch and commits remediation changes when the run has a branch", async () => {
    const { deps, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runRemediation("run-1", { f1: 500 });

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("Remediation"),
    );
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
  });

  it("skips git operations when the run has no branch", async () => {
    const { deps, gitService } = buildDeps({ run: makeRun({ branchName: null }) });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runRemediation("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("posts execution report update and remediation resolutions to GitHub when a PR exists", async () => {
    const { deps, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());
    const commentMap = { f1: 999 };

    await svc.runRemediation("run-1", commentMap);

    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      77,
      expect.objectContaining({ executionVersion: 2 }),
    );
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      77,
      expect.arrayContaining([expect.objectContaining({ findingId: "f1" })]),
      commentMap,
    );
  });

  it("does not touch GitHub sync when the run has no PR number", async () => {
    const { deps, githubSync } = buildDeps({ run: makeRun({ prNumber: null }) });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runRemediation("run-1");

    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });

  it("posts both the updated execution report comment and the remediation summary comment", async () => {
    const { deps, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runRemediation("run-1");

    const messages = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[1] as string,
    );
    expect(messages.some((m) => m.includes("Execution Report"))).toBe(true);
    expect(messages.some((m) => m.includes("Remediation Summary"))).toBe(true);
    const remediationSummary = messages.find((m) => m.includes("Remediation Summary"))!;
    expect(remediationSummary).toContain("Fixed it");
    expect(remediationSummary).toContain("Was a real bug");
  });

  it("transitions REMEDIATION_FINISHED then REVIEW_APPROVED and calls markReady on completion", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runRemediation("run-1");

    expect(runRepo.updateState).toHaveBeenNthCalledWith(1, "run-1", RunState.AIReview);
    expect(runRepo.updateState).toHaveBeenNthCalledWith(2, "run-1", RunState.ReadyForHumanReview);
    expect(markReadySpy).toHaveBeenCalledTimes(1);
  });
});

describe("OrchestratorService.markReady", () => {
  function buildMarkReadyDeps(overrides: {
    run?: Run;
    review?: Review | null;
    executionReport?: ExecutionReport | null;
  } = {}) {
    const run =
      overrides.run ??
      makeRun({ state: RunState.AIReview, prNumber: 77 });
    const review =
      overrides.review === undefined
        ? makeReview({ overallVerdict: "approved", findings: [] })
        : overrides.review;
    const executionReport =
      overrides.executionReport === undefined
        ? makeExecutionReport({
            checks: {
              lint: { status: "pass", details: "ok" },
              typecheck: { status: "pass", details: "ok" },
              tests: { status: "pass", details: "ok" },
            },
          })
        : overrides.executionReport;

    const runRepo = {
      findById: vi.fn().mockResolvedValue(run),
      findActiveByIssueId: vi.fn(),
      findAll: vi.fn(),
      create: vi.fn(),
      findByIssueId: vi.fn(),
      updateState: vi.fn(),
      update: vi.fn(),
    };
    const artifactRepo = {
      create: vi.fn(),
      findByRunId: vi.fn(),
      findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
        if (type === "Review") {
          return Promise.resolve(
            review ? makeArtifact({ type: "Review", payloadJson: review }) : null,
          );
        }
        if (type === "ExecutionReport") {
          return Promise.resolve(
            executionReport
              ? makeArtifact({ type: "ExecutionReport", payloadJson: executionReport })
              : null,
          );
        }
        return Promise.resolve(null);
      }),
    };
    const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
    const linearClient = { getIssue: vi.fn(), postComment: vi.fn().mockResolvedValue(undefined) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    return {
      deps: {
        runRepo,
        artifactRepo,
        eventRepo,
        linearClient,
        githubClient: { getPRDiff: vi.fn() },
        gitService: {
          setupRunWorktree: vi.fn(),
          assertBranch: vi.fn(),
          commitAndPush: vi.fn(),
          removeWorktree: vi.fn(),
          resolveMainRepoPath: vi.fn().mockReturnValue(run.workingDirectory),
        },
        repoRegistry: {
          resolveForIssue: vi.fn(),
          resolveWorkingDirectory: vi.fn(),
          validateWorkingDirectory: vi.fn(),
          getRepoByName: vi.fn(),
          getDefaultRepo: vi.fn(),
        },
        linearSync: { syncState: vi.fn().mockResolvedValue(undefined) },
        githubSync: { syncState: vi.fn().mockResolvedValue(undefined) },
        plannerAgent: { run: vi.fn() },
        planReviewerAgent: { run: vi.fn() },
        planReviserAgent: { run: vi.fn() },
        executorAgent: { run: vi.fn() },
        reviewerAgent: { run: vi.fn() },
        remediationAgent: { run: vi.fn() },
        logger,
      },
      linearClient,
    };
  }

  it("posts the completion comment when the run is ready", async () => {
    const { deps, linearClient } = buildMarkReadyDeps();
    const svc = new OrchestratorService(deps as never);

    const result = await svc.markReady("run-1");

    expect(result).toBeDefined();
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
  });

  it("propagates the PolicyViolationError when checks are not all green", async () => {
    const { deps } = buildMarkReadyDeps({
      executionReport: makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "fail", details: "still red" },
        },
      }),
    });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
  });
});
