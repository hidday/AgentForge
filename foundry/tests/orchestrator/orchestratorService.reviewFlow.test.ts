import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
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
    branchName: null,
    prNumber: 10,
    state: RunState.AIReview,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
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
    summary: "review summary",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeArtifact<T>(type: Artifact["type"], payload: T, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: `artifact-${type}`,
    runId: "run-1",
    type,
    version: 1,
    payloadJson: payload as unknown,
    rawText: JSON.stringify(payload),
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
      identifier: "LIN-1",
      title: "Test issue",
      description: "Test description",
      url: "https://linear.app/x",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff --git a/src/a.ts b/src/a.ts"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const defaultRepoEntry = {
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
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(defaultRepoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/repos/test-repo"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(defaultRepoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(defaultRepoEntry),
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
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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
    githubClient,
    githubSync,
    reviewerAgent,
    remediationAgent,
    gitService,
    logger,
  };
}

describe("OrchestratorService.runReview", () => {
  it("throws PolicyViolationError when the run is not in AIReview", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) =>
      type === "ExecutionReport" ? Promise.resolve(makeArtifact("ExecutionReport", makeExecutionReport())) : Promise.resolve(null),
    );

    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);
    expect(reviewerAgent.run).not.toHaveBeenCalled();
  });

  it("throws PolicyViolationError when there is no PR number", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: null }));
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) =>
      type === "ExecutionReport" ? Promise.resolve(makeArtifact("ExecutionReport", makeExecutionReport())) : Promise.resolve(null),
    );

    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("throws PolicyViolationError when there is no execution report", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("fetches the PR diff and posts findings when the PR has findings, then requests remediation", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubClient, githubSync, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AIReview, prNumber: 10 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact("ExecutionReport", makeExecutionReport()));
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", makePlan()));
      return Promise.resolve(null);
    });

    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "blocker", type: "bug", file: "src/a.ts", title: "Bad", details: "fix me" }],
    });
    reviewerAgent.run.mockResolvedValue(review);
    githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 555]]));

    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AIReview, reviewerRuntime: "codex" }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));

    const remediatedRun = makeRun({ state: RunState.ReadyForHumanReview });
    const runRemediationSpy = vi.spyOn(svc, "runRemediation").mockResolvedValue(remediatedRun);

    const result = await svc.runReview("run-1");

    expect(githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 10);
    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      10,
      review.findings,
      "changes_requested",
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Changes Requested"),
    );
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", { f1: 555 });
    expect(result).toBe(remediatedRun);
  });

  it("skips posting PR findings when the review has no findings", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AIReview, prNumber: 10 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact("ExecutionReport", makeExecutionReport()));
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", makePlan()));
      return Promise.resolve(null);
    });

    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved", findings: [] }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
  });

  // NOTE: the `diff = run.prNumber ? await getPRDiff(...) : ""` false branch is guarded
  // by policy.assertCanReview, which already throws PolicyViolationError when
  // !run.prNumber (see the "throws ... no PR number" test above). That makes the ""
  // branch unreachable through the public API and is not exercised here; see report.
});

describe("OrchestratorService.runRemediation", () => {
  it("throws PolicyViolationError when the run is not in AddressingReview", async () => {
    const { deps, runRepo, artifactRepo, remediationAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) =>
      type === "Review"
        ? Promise.resolve(makeArtifact("Review", makeReview({ overallVerdict: "changes_requested", findings: [{ id: "f1", severity: "blocker", type: "x", file: "a", title: "t", details: "d" }] })))
        : Promise.resolve(null),
    );

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);
    expect(remediationAgent.run).not.toHaveBeenCalled();
  });

  it("commits and pushes remediation changes when the run has a branchName, and posts PR updates when it has a PR", async () => {
    const { deps, runRepo, artifactRepo, remediationAgent, gitService, githubSync, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({
      state: RunState.AddressingReview,
      branchName: "ai/run-1",
      workingDirectory: "/tmp/worktree",
      prNumber: 10,
    });
    runRepo.findById.mockResolvedValue(run);

    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "blocker", type: "x", file: "a", title: "t", details: "d" }],
    });
    const executionReport = makeExecutionReport({ executionVersion: 1, score: 0.7 });
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact("Review", review));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact("ExecutionReport", executionReport));
      return Promise.resolve(null);
    });

    const newExecutionReport = makeExecutionReport({ executionVersion: 2, score: 0.95 });
    remediationAgent.run.mockResolvedValue({
      executionReport: newExecutionReport,
      resolution: [{ findingId: "f1", status: "fixed", action: "patched", rationale: "done" }],
    });

    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AddressingReview, remediationRuntime: "claude-code" }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview }));

    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    const commentMap = { f1: 555 };
    const result = await svc.runRemediation("run-1", commentMap);

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      "[AI] Remediation: address review findings",
    );
    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith("test-repo", 10, newExecutionReport);
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      10,
      [{ findingId: "f1", status: "fixed", action: "patched", rationale: "done" }],
      commentMap,
    );
    expect(linearClient.postComment).toHaveBeenCalledWith("LIN-1", expect.stringContaining("Execution Report"));
    expect(linearClient.postComment).toHaveBeenCalledWith("LIN-1", expect.stringContaining("Remediation Summary"));
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("skips branch operations and PR updates when the run has no branchName or PR", async () => {
    const { deps, runRepo, artifactRepo, remediationAgent, gitService, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: null });
    runRepo.findById.mockResolvedValue(run);

    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "blocker", type: "x", file: "a", title: "t", details: "d" }],
    });
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact("Review", review));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact("ExecutionReport", makeExecutionReport()));
      return Promise.resolve(null);
    });

    remediationAgent.run.mockResolvedValue({
      executionReport: makeExecutionReport({ executionVersion: 2 }),
      resolution: [],
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AddressingReview, prNumber: null }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: null }))
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: null }));
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview, prNumber: null }));

    await svc.runRemediation("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.markReady", () => {
  it("throws PolicyViolationError when checks failed", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 10 }));
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(
          makeArtifact(
            "ExecutionReport",
            makeExecutionReport({ checks: { lint: { status: "fail", details: "bad" }, typecheck: { status: "pass", details: "" }, tests: { status: "pass", details: "" } } }),
          ),
        );
      if (type === "Review") return Promise.resolve(makeArtifact("Review", makeReview({ overallVerdict: "approved" })));
      return Promise.resolve(null);
    });

    await expect(svc.markReady("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("posts the completion comment on success", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AIReview, prNumber: 10 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact("ExecutionReport", makeExecutionReport()));
      if (type === "Review") return Promise.resolve(makeArtifact("Review", makeReview({ overallVerdict: "approved" })));
      return Promise.resolve(null);
    });

    const result = await svc.markReady("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
    expect(result).toBe(run);
  });
});
