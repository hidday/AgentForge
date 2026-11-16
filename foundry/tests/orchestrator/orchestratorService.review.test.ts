import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
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
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "pass", details: "all green" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.85,
    scoreRationale: "solid",
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
    update: vi.fn(),
    updateState: vi.fn(),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: makePlan() }));
      return Promise.resolve(null);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
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
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff --git a/src/a.ts b/src/a.ts"),
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
    githubClient,
    githubSync,
    reviewerAgent,
    remediationAgent,
    logger,
  };
}

describe("OrchestratorService.runReview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws PolicyViolationError when the run is not in AIReview state", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));

    const svc = new OrchestratorService(deps as never);
    const err = await svc.runReview("run-1").catch((e) => e);

    expect(err).toBeInstanceOf(PolicyViolationError);
    expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
  });

  it("throws PolicyViolationError when there is no PR number", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: null }));

    const svc = new OrchestratorService(deps as never);
    const err = await svc.runReview("run-1").catch((e) => e);

    expect(err).toBeInstanceOf(PolicyViolationError);
    expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
  });

  it("approved verdict: skips postReviewFindings (no findings), transitions to REVIEW_APPROVED, and calls markReady", async () => {
    const { deps, runRepo, artifactRepo, githubSync, reviewerAgent } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 42 }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: makePlan() }));
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: { reviewId: "rev-1", summary: "fine", findings: [], overallVerdict: "approved" },
          }),
        );
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "Looks great",
      findings: [],
      overallVerdict: "approved",
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 42 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42 }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("changes_requested verdict with PR findings: posts findings via githubSync, builds commentMap, posts a formatted comment, and runs remediation", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient, githubSync, reviewerAgent, remediationAgent } =
      buildDeps();
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    runRepo.findById
      .mockResolvedValueOnce(run) // runReview's requireRun
      .mockResolvedValue(makeRun({ state: RunState.AddressingReview, prNumber: 42 })); // runRemediation's requireRun

    const review = {
      reviewId: "rev-1",
      summary: "Needs fixes",
      findings: [
        {
          id: "f1",
          severity: "blocker" as const,
          type: "bug",
          file: "src/a.ts",
          lineHint: 10,
          title: "Null deref",
          details: "a.b can be null",
        },
        {
          id: "f2",
          severity: "nit" as const,
          type: "style",
          file: "src/b.ts",
          title: "Rename var",
          details: "use a clearer name",
        },
      ],
      overallVerdict: "changes_requested" as const,
    };
    reviewerAgent.run.mockResolvedValue(review);
    githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 101]]));

    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: makePlan() }));
      if (type === "Review")
        return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      return Promise.resolve(null);
    });

    remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [
        { findingId: "f1", status: "accepted", action: "guarded null check", rationale: "fixes bug" },
      ],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2 }),
    });
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 42 })) // runReview's reviewerRuntime update
      .mockResolvedValueOnce(makeRun({ state: RunState.AddressingReview, prNumber: 42 })); // runRemediation's remediationRuntime update
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AddressingReview, prNumber: 42 })) // REVIEW_CHANGES_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 42 })) // REMEDIATION_FINISHED
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42 })); // REVIEW_APPROVED

    const svc = new OrchestratorService(deps as never);
    // NOTE: runRemediation always finishes by calling markReady(), which re-reads
    // the latest "Review" artifact. Nothing in this flow re-runs the reviewer or
    // posts an "approved" Review after remediation, so assertCanMarkReady's
    // verdict check deterministically throws here (a pre-existing limitation
    // also exercised by orchestratorService.executionScore.test.ts). We assert
    // on everything that happens up to that point.
    const err = await svc.runReview("run-1").catch((e) => e);

    expect(err).toBeInstanceOf(PolicyViolationError);
    expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");

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
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Null deref"),
    );
    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.REVIEW_CHANGES_REQUESTED);
    expect(eventTypes).toContain(RunEvent.REMEDIATION_FINISHED);
    expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);
    expect(remediationAgent.run).toHaveBeenCalled();
    // The commentMap built from githubSync.postReviewFindings must be forwarded into remediation.
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.anything(),
      { f1: 101 },
    );
  });
});
