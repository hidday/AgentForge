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
    branchName: "ai/run-1",
    prNumber: 5,
    state: RunState.AIReview,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: "claude-code",
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
    summary: "Implemented the feature.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Clean implementation.",
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
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    }),
    getRelatedContext: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn().mockResolvedValue("diff content"), getDefaultBranch: vi.fn() };

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
    postReviewFindings: vi.fn().mockResolvedValue(new Map([["f1", 101]])),
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
    githubClient,
    githubSync,
    reviewerAgent,
    remediationAgent,
  };
}

describe("OrchestratorService.runReview", () => {
  it("throws when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(null);

    await expect(svc.runReview("missing-run")).rejects.toThrow("Run not found: missing-run");
  });

  it("throws PolicyViolationError when run is not in AIReview state", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
    );

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runReview("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("review_requires_ai_review_state");
  });

  it("throws PolicyViolationError when there's no PR number", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ prNumber: null }));
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
    );

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runReview("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("review_requires_pr");
  });

  it("throws PolicyViolationError when there's no ExecutionReport artifact", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findLatestByType.mockResolvedValue(null);

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runReview("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("review_requires_execution_report");
  });

  it("fetches the PR diff using run.repo and run.prNumber before invoking the reviewer agent", async () => {
    const { deps, runRepo, artifactRepo, githubClient, reviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ prNumber: 42 });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, reviewerRuntime: "codex" });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42 }));

    const plan = makePlan();
    const report = makeExecutionReport();
    const review: Review = { reviewId: "rev-1", overallVerdict: "approved", summary: "ok", findings: [] };
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: report }));
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(review);

    await svc.runReview("run-1");

    expect(githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 42);
    expect(reviewerAgent.run).toHaveBeenCalledWith(plan, report, "diff content", expect.anything(), "run-1");
  });

  it("changes_requested: posts findings to GitHub (building the comment map), posts the Linear comment, and chains into runRemediation", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, remediationAgent, githubSync, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const aiReviewRun = makeRun({ state: RunState.AIReview });
    const addressingReviewRun = makeRun({ state: RunState.AddressingReview });

    runRepo.findById.mockResolvedValueOnce(aiReviewRun).mockResolvedValue(addressingReviewRun);
    runRepo.update.mockResolvedValue({ ...aiReviewRun, reviewerRuntime: "codex" });
    runRepo.updateState.mockResolvedValueOnce(addressingReviewRun);

    const plan = makePlan();
    const report = makeExecutionReport();
    const review: Review = {
      reviewId: "rev-1",
      overallVerdict: "changes_requested",
      summary: "Needs fixes",
      findings: [{ id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "oops" }],
    };
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: report }));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(review);

    // Stub out runRemediation so this test stays focused on runReview's own branching.
    const runRemediationSpy = vi
      .spyOn(svc, "runRemediation")
      .mockResolvedValue(addressingReviewRun);

    const result = await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith("test-repo", 5, review.findings, "changes_requested");
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("AI Code Review -- Changes Requested"),
    );
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", { f1: 101 });
    expect(result).toBe(addressingReviewRun);
  });

  it("approved: does NOT post review findings to GitHub (no findings) and calls markReady", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const aiReviewRun = makeRun({ state: RunState.AIReview });
    const readyRun = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValueOnce(aiReviewRun).mockResolvedValue(readyRun);
    runRepo.update.mockResolvedValue({ ...aiReviewRun, reviewerRuntime: "codex" });
    runRepo.updateState.mockResolvedValueOnce(readyRun);

    const plan = makePlan();
    const report = makeExecutionReport();
    const review: Review = { reviewId: "rev-1", overallVerdict: "approved", summary: "ok", findings: [] };
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: report }));
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(review);

    const result = await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });
});
