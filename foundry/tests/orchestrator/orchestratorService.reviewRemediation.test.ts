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
    summary: "Done",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Good",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Found issues",
    findings: [
      { id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "Fix it" },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function makeArtifact(type: string, version: number, payloadJson: unknown): Artifact {
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
      title: "Test",
      description: "Test",
      branchName: "ai/run-1",
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
    gitService,
  };
}

describe("OrchestratorService.runReview", () => {
  it("throws a PolicyViolationError when the run is not in AIReview state", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact("ExecutionReport", 1, makeExecutionReport()));

    const err: PolicyViolationError = await svc.runReview("run-1").catch((e) => e);
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect(err.rule).toBe("review_requires_ai_review_state");
  });

  it("throws a PolicyViolationError when there is no PR number", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: null }));
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact("ExecutionReport", 1, makeExecutionReport()));

    const err: PolicyViolationError = await svc.runReview("run-1").catch((e) => e);
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect(err.rule).toBe("review_requires_pr");
  });

  it("throws a PolicyViolationError when there is no execution report", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 42 }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    const err: PolicyViolationError = await svc.runReview("run-1").catch((e) => e);
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect(err.rule).toBe("review_requires_execution_report");
  });

  it("approved verdict: posts findings (if any), transitions to ReadyForHumanReview, and calls markReady (whose own return value is discarded)", async () => {
    const { deps, runRepo, artifactRepo, githubSync, reviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const plan = makePlan();
    const report = makeExecutionReport();
    // Non-blocker finding alongside an approved verdict (findings can exist
    // even when overallVerdict is "approved").
    const review = makeReview({
      overallVerdict: "approved",
      findings: [{ id: "f1", severity: "minor", type: "style", file: "a.ts", title: "nit", details: "d" }],
    });
    const approvedRun = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42 });

    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, reviewerRuntime: "codex" });
    runRepo.updateState.mockResolvedValue(approvedRun);

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact("ExecutionReport", 1, report));
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 1, plan));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(review);

    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun({ state: RunState.Done }));

    const result = await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      run.repo,
      42,
      review.findings,
      "approved",
    );
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    // The REVIEW_APPROVED-transitioned run is returned, NOT markReady's return value.
    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(result.state).not.toBe(RunState.Done);
  });

  it("does not post findings when there are none, even with prNumber set", async () => {
    const { deps, runRepo, artifactRepo, githubSync, reviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const plan = makePlan();
    const report = makeExecutionReport();
    const review = makeReview({ overallVerdict: "approved", findings: [] });

    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, reviewerRuntime: "codex" });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact("ExecutionReport", 1, report));
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 1, plan));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(review);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun({ state: RunState.Done }));

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
  });

  it("changes_requested verdict: posts the code review comment and delegates to runRemediation with the comment map", async () => {
    const { deps, runRepo, artifactRepo, linearClient, githubSync, reviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const plan = makePlan();
    const report = makeExecutionReport();
    const review = makeReview({ overallVerdict: "changes_requested" });
    const addressingReviewRun = makeRun({ state: RunState.AddressingReview, prNumber: 42 });

    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, reviewerRuntime: "codex" });
    runRepo.updateState.mockResolvedValue(addressingReviewRun);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact("ExecutionReport", 1, report));
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 1, plan));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(review);

    const runRemediationSpy = vi
      .spyOn(svc, "runRemediation")
      .mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const result = await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(run.repo, 42, review.findings, "changes_requested");
    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Changes Requested"),
    );
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", { f1: 123 });
    expect(result.state).toBe(RunState.AIReview);
  });
});

describe("OrchestratorService.runRemediation", () => {
  it("throws a PolicyViolationError when the run is not in AddressingReview state", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact("Review", 1, makeReview()));

    const err: PolicyViolationError = await svc.runRemediation("run-1").catch((e) => e);
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect(err.rule).toBe("remediate_requires_addressing_review_state");
  });

  it("throws a PolicyViolationError when there is no review artifact", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    const err: PolicyViolationError = await svc.runRemediation("run-1").catch((e) => e);
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect(err.rule).toBe("remediate_requires_review");
  });

  it("throws a PolicyViolationError when the review verdict is not changes_requested", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact("Review", 1, makeReview({ overallVerdict: "approved" })),
    );

    const err: PolicyViolationError = await svc.runRemediation("run-1").catch((e) => e);
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect(err.rule).toBe("remediate_requires_changes_requested_verdict");
  });

  it("throws a PolicyViolationError when the review has no findings", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact("Review", 1, makeReview({ overallVerdict: "changes_requested", findings: [] })),
    );

    const err: PolicyViolationError = await svc.runRemediation("run-1").catch((e) => e);
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect(err.rule).toBe("remediate_requires_findings");
  });

  it("commits a checkpoint and syncs GitHub only when branchName/prNumber are set, then surfaces markReady's policy failure", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient, githubSync, gitService, remediationAgent } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AddressingReview, branchName: "ai/run-1", prNumber: 42 });
    const review = makeReview({ overallVerdict: "changes_requested" });
    const report = makeExecutionReport({ executionVersion: 1 });
    const newReport = makeExecutionReport({
      executionVersion: 2,
      score: 0.95,
      scoreRationale: "Fixed",
    });
    const remediation = {
      reviewId: "rev-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "Fixed bug", rationale: "Real issue" }],
      readyForHumanReview: true,
      executionReport: newReport,
    };

    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, remediationRuntime: "claude-code" });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact("Review", 1, review));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact("ExecutionReport", 1, report));
      return Promise.resolve(null);
    });
    remediationAgent.run.mockResolvedValue(remediation);

    const err: PolicyViolationError = await svc.runRemediation("run-1", { f1: 7 }).catch((e) => e);

    // Known limitation: runRemediation never updates the Review artifact to
    // "approved", so markReady always fails this policy check afterwards.
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect(err.rule).toBe("ready_requires_approved_verdict");

    expect(gitService.assertBranch).toHaveBeenCalledWith(run.workingDirectory, "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      run.workingDirectory,
      "ai/run-1",
      "[AI] Remediation: address review findings",
    );
    expect(remediationAgent.run).toHaveBeenCalledWith(review, report, run.workingDirectory, "run-1");

    const comments = linearClient.postComment.mock.calls.map((c: unknown[]) => c[1] as string);
    expect(comments.some((c) => c.includes("Execution Report"))).toBe(true);
    expect(comments.some((c) => c.includes("Remediation Summary"))).toBe(true);

    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(run.repo, 42, newReport);
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      run.repo,
      42,
      remediation.resolution,
      { f1: 7 },
    );

    const finishedEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.REMEDIATION_FINISHED,
    );
    expect(finishedEvent).toBeDefined();
  });

  it("skips git checkpointing when branchName is absent, and skips GitHub sync when prNumber is absent", async () => {
    const { deps, runRepo, artifactRepo, githubSync, gitService, remediationAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: null });
    const review = makeReview({ overallVerdict: "changes_requested" });
    const report = makeExecutionReport({ executionVersion: 1 });
    const newReport = makeExecutionReport({ executionVersion: 2 });
    const remediation = {
      reviewId: "rev-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "Fixed bug", rationale: "ok" }],
      readyForHumanReview: true,
      executionReport: newReport,
    };

    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, remediationRuntime: "claude-code" });
    runRepo.updateState.mockResolvedValue({
      ...run,
      state: RunState.AIReview,
      remediationRuntime: "claude-code",
    });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact("Review", 1, review));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact("ExecutionReport", 1, report));
      return Promise.resolve(null);
    });
    remediationAgent.run.mockResolvedValue(remediation);

    await svc.runRemediation("run-1").catch(() => undefined);

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });
});
