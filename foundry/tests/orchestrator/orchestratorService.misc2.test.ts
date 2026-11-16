import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { PlanReview } from "../../src/schemas/planReview.js";

/**
 * A second round of targeted branch-coverage tests for behavioral (not
 * purely defensive) branches left uncovered after
 * orchestratorService.misc.test.ts: rejectPlan's "fresh" mode (skips
 * loadReplanContext entirely), answerQuestions re-injecting prior
 * ResearchedAnswers, runManualPlanRevision without an operator note, and a
 * couple of comment-formatting branches (non-"pass" check icons, a plan
 * review finding with an affectedStepId).
 */

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
    prNumber: null,
    state: RunState.AwaitingPlanApproval,
    planVersion: 2,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 2,
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

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "pr-1",
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
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
    version: 2,
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
  const artifactRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
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
  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main") };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
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
    assertBranch: vi.fn(),
    commitAndPush: vi.fn(),
    removeWorktree: vi.fn(),
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
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    executorAgent,
    reviewerAgent,
  };
}

describe("OrchestratorService.rejectPlan (fresh mode)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips loadReplanContext entirely: no previousPlan/humanAnswers/researchedAnswers/planReviewFindings are injected, even when prior artifacts exist", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }))
      .mockResolvedValue(makeRun({ state: RunState.PlanReview, planVersion: 3 }));

    // Prior artifacts exist, but "fresh" mode must ignore all of them.
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: makePlan({ planVersion: 3 }) }));
      if (type === "HumanAnswers")
        return Promise.resolve(
          makeArtifact({ type: "HumanAnswers", payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] } }),
        );
      if (type === "RejectionContext")
        return Promise.resolve(
          makeArtifact({
            type: "RejectionContext",
            payloadJson: { planVersion: 2, feedback: "start over please", source: "api", mode: "fresh" },
          }),
        );
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 3 }));
    planReviewerAgent.run.mockResolvedValue(makePlanReview());
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 3 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, planVersion: 2 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 3 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 }));

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1", "start over please", "api", "fresh");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({
        previousPlan: expect.anything(),
        humanAnswers: expect.anything(),
        researchedAnswers: expect.anything(),
        planReviewFindings: expect.anything(),
      }),
    );
    // humanFeedback is still injected in fresh mode (it comes from the
    // RejectionContext artifact this same call creates, not from loadReplanContext).
    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanFeedback: { planVersion: 2, feedback: "start over please" },
      }),
    );
  });
});

describe("OrchestratorService.runManualPlanRevision (no operator note)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls runPlanRevision with undefined options when no note is given", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent } = buildDeps();
    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }))
      .mockResolvedValue(makeRun({ state: RunState.PlanRevision }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ payloadJson: makePlan() })) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "nit", type: "style", title: "x", details: "y" }],
      }),
    );
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 3 }),
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 3 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanRevision }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    const svc = new OrchestratorService(deps as never);
    await svc.runManualPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});

describe("OrchestratorService comment formatting (non-pass checks, affectedStepId)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders fail/skip check icons distinctly in the execution report comment", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, reviewerAgent, linearClient } = buildDeps();
    const run = makeRun({ state: RunState.Implementing, planVersion: 1, approvedPlanVersion: 1 });
    runRepo.findById
      .mockResolvedValueOnce(run)
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 5 }));
    let execCalls = 0;
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: makePlan({ planVersion: 1 }) }));
      if (type === "ExecutionReport") {
        execCalls += 1;
        return Promise.resolve(
          execCalls === 1 ? null : makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
        );
      }
      if (type === "Review")
        return Promise.resolve(makeArtifact({ type: "Review", payloadJson: makePlanReview() as never }));
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "2 errors" },
          typecheck: { status: "skip", details: "not run" },
          tests: { status: "pass", details: "ok" },
        },
      }),
      prNumber: 5,
    });
    reviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: 5 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 5 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 5 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 5 }));

    const svc = new OrchestratorService(deps as never);
    await svc.runExecution("run-1");

    const reportComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    const body = reportComment![1] as string;
    expect(body).toContain(":x:"); // fail
    expect(body).toContain(":heavy_minus_sign:"); // skip
    expect(body).toContain(":white_check_mark:"); // pass
  });

  it("includes the affected step id in a plan review comment when a finding names one", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent, linearClient } = buildDeps();
    const run = makeRun({ state: RunState.PlanReview, planVersion: 2 });
    runRepo.findById
      .mockResolvedValueOnce(run)
      .mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ payloadJson: makePlan({ planVersion: 2 }) })) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "gap",
            affectedStepId: "s1",
            title: "Missing validation",
            details: "Step 1 needs input validation",
          },
        ],
      }),
    );
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 3 }),
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 3 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanRevision }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanReview("run-1");

    const reviewComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Missing validation"),
    );
    expect(reviewComment).toBeDefined();
    expect(reviewComment![1] as string).toContain("(step s1)");
  });
});
