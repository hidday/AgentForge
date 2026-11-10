import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run } from "../../src/domain/types.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: 99,
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks good.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Found an issue",
    findings: [
      { id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "x" },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function buildDeps(initialRun: Run, artifactOverrides: Record<string, unknown> = {}) {
  let currentRun = initialRun;
  const artifacts = new Map<string, unknown>(Object.entries(artifactOverrides));

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(currentRun)),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      currentRun = { ...currentRun, state: newState };
      return Promise.resolve(currentRun);
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      currentRun = { ...currentRun, ...patch };
      return Promise.resolve(currentRun);
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi
      .fn()
      .mockImplementation((_id: string, type: string) =>
        Promise.resolve(artifacts.get(type) ?? null),
      ),
  };

  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "ENG-1",
      title: "Title",
      description: "desc",
      branchName: "ai/lin-1",
      state: "Todo",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff content"),
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
    postReviewFindings: vi.fn().mockResolvedValue(new Map([["f1", 123]])),
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
      reviewId: "rev-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "Fixed", rationale: "Real bug" }],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2, score: 0.95 }),
    }),
  };

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
    },
    runRepo,
    artifactRepo,
    linearClient,
    githubClient,
    githubSync,
    reviewerAgent,
    remediationAgent,
    gitService,
    getCurrentRun: () => currentRun,
  };
}

describe("OrchestratorService.runReview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects via PolicyViolationError when there is no execution report", async () => {
    const built = buildDeps(makeRun());
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("changes_requested with a PR: posts review findings to GitHub, transitions to AddressingReview, and delegates to runRemediation with the comment map", async () => {
    const built = buildDeps(makeRun(), { ExecutionReport: { payloadJson: makeExecutionReport() } });
    const svc = new OrchestratorService(built.deps as never);
    const runRemediationSpy = vi
      .spyOn(svc, "runRemediation")
      .mockResolvedValue(makeRun({ state: RunState.AddressingReview }) as Run);

    await svc.runReview("run-1");

    expect(built.githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 99);
    expect(built.githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      99,
      expect.any(Array),
      "changes_requested",
    );
    expect(built.getCurrentRun().state).toBe(RunState.AddressingReview);
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", { f1: 123 });
    const comment = (built.linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(comment).toContain("Changes Requested");
  });

  it("changes_requested with zero findings: does not call postReviewFindings, but still delegates to runRemediation with an empty comment map", async () => {
    const built = buildDeps(makeRun(), { ExecutionReport: { payloadJson: makeExecutionReport() } });
    built.reviewerAgent.run.mockResolvedValue(makeReview({ findings: [] }));
    const svc = new OrchestratorService(built.deps as never);
    const runRemediationSpy = vi
      .spyOn(svc, "runRemediation")
      .mockResolvedValue(makeRun({ state: RunState.AddressingReview }) as Run);

    await svc.runReview("run-1");

    expect(built.githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", {});
  });

  it("approved: transitions to ReadyForHumanReview and delegates to markReady instead of runRemediation", async () => {
    const built = buildDeps(makeRun(), { ExecutionReport: { payloadJson: makeExecutionReport() } });
    built.reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved", findings: [] }));
    const svc = new OrchestratorService(built.deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun() as Run);
    const runRemediationSpy = vi.spyOn(svc, "runRemediation");

    const result = await svc.runReview("run-1");

    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(runRemediationSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runRemediation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects via PolicyViolationError when the run is not in AddressingReview state", async () => {
    const built = buildDeps(makeRun({ state: RunState.AIReview }), {
      Review: { payloadJson: makeReview() },
    });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("rejects via PolicyViolationError when the latest review has no findings", async () => {
    const built = buildDeps(makeRun({ state: RunState.AddressingReview }), {
      Review: { payloadJson: makeReview({ findings: [] }) },
    });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("happy path with a PR: commits remediation changes, posts both comments, syncs GitHub, and marks ready", async () => {
    const built = buildDeps(makeRun({ state: RunState.AddressingReview }), {
      Review: { payloadJson: makeReview() },
      ExecutionReport: { payloadJson: makeExecutionReport() },
    });
    const svc = new OrchestratorService(built.deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun() as Run);

    await svc.runRemediation("run-1", { f1: 123 });

    expect(built.gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(built.gitService.commitAndPush).toHaveBeenCalledOnce();
    expect(built.githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      99,
      expect.objectContaining({ executionVersion: 2 }),
    );
    expect(built.githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      99,
      expect.any(Array),
      { f1: 123 },
    );
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    const comments = (built.linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[1] as string,
    );
    expect(comments.some((c) => c.includes("Execution Report"))).toBe(true);
    expect(comments.some((c) => c.includes("Remediation Summary"))).toBe(true);
  });

  it("skips branch assertion and GitHub sync calls when the run has no branchName/PR", async () => {
    const built = buildDeps(makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: null }), {
      Review: { payloadJson: makeReview() },
      ExecutionReport: { payloadJson: makeExecutionReport() },
    });
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun() as Run);

    await svc.runRemediation("run-1");

    expect(built.gitService.assertBranch).not.toHaveBeenCalled();
    expect(built.gitService.commitAndPush).not.toHaveBeenCalled();
    expect(built.githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(built.githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.markReady", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects via PolicyViolationError when there is no PR", async () => {
    const built = buildDeps(makeRun({ prNumber: null }));
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.markReady("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("happy path: posts the completion comment and returns the run", async () => {
    const built = buildDeps(makeRun(), {
      ExecutionReport: { payloadJson: makeExecutionReport() },
      Review: { payloadJson: makeReview({ overallVerdict: "approved", findings: [] }) },
    });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.markReady("run-1");

    expect(result.id).toBe("run-1");
    const comment = (built.linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(comment).toContain("Ready for Human Review");
  });

  it("rejects via PolicyViolationError when there are unresolved blocker findings", async () => {
    const built = buildDeps(makeRun(), {
      ExecutionReport: { payloadJson: makeExecutionReport() },
      Review: {
        payloadJson: makeReview({
          overallVerdict: "approved",
          findings: [
            { id: "f1", severity: "blocker", type: "bug", file: "x.ts", title: "Blocker", details: "x" },
          ],
        }),
      },
    });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.markReady("run-1")).rejects.toThrow(PolicyViolationError);
  });
});
