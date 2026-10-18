import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";

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
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/worktree",
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Add the thing",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Do it", description: "Do the thing" }],
    testPlan: "Run the tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the thing",
    filesChanged: ["src/thing.ts"],
    checks: {
      lint: { status: "pass", details: "" },
      typecheck: { status: "pass", details: "" },
      tests: { status: "pass", details: "" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Looks solid",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function buildDeps() {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };
  const artifactRepo = { create: vi.fn(), findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = { getIssue: vi.fn(), postComment: vi.fn(), getRelatedContext: vi.fn() };
  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };
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
        maxFilesChanged: 100,
        maxDiffLines: 5000,
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
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/worktree"),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
  };
  const issue = {
    id: "LIN-1",
    title: "Add the thing",
    description: "desc",
    branchName: "ai/lin-1",
    labels: [],
    priority: 1,
    project: "proj",
  };
  linearClient.getIssue.mockResolvedValue(issue);
  linearClient.getRelatedContext.mockResolvedValue({ blockers: [] });

  return {
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
  };
}

describe("OrchestratorService.approvePlan", () => {
  it("records the approved plan version, transitions to Implementing, and posts a plain comment", async () => {
    const deps = buildDeps();
    const run = makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: null });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan"
        ? Promise.resolve({ payloadJson: makePlan({ planVersion: 2 }) })
        : Promise.resolve(null),
    );
    const runWithApproval = makeRun({ approvedPlanVersion: 2, state: RunState.AwaitingPlanApproval });
    deps.runRepo.update.mockResolvedValue(runWithApproval);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Implementing }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approvePlan("run-1");

    expect(deps.runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 2 });
    expect(deps.runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.Implementing);
    expect(deps.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v2 approved. Starting implementation...",
    );
    expect(result.state).toBe(RunState.Implementing);
  });

  it("includes the operator note in the approval comment when provided", async () => {
    const deps = buildDeps();
    const run = makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: null });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan"
        ? Promise.resolve({ payloadJson: makePlan({ planVersion: 1 }) })
        : Promise.resolve(null),
    );
    deps.runRepo.update.mockResolvedValue(
      makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 1 }),
    );
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Implementing }));

    const svc = new OrchestratorService(deps as never);
    await svc.approvePlan("run-1", { note: "ship it fast" });

    expect(deps.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("ship it fast"),
    );
  });

  it("throws when there is no plan artifact for the run", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.runExecution", () => {
  function setupHappyPath(deps: ReturnType<typeof buildDeps>) {
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan() });
      return Promise.resolve(null);
    });
    deps.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport(),
      prNumber: 7,
    });
    deps.runRepo.update.mockResolvedValue(
      makeRun({ state: RunState.Implementing, prNumber: 7, executorRuntime: "claude-code" }),
    );
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 7 }));
  }

  it("runs the executor, records EXECUTION_STARTED/FINISHED, and proceeds to review", async () => {
    const deps = buildDeps();
    setupHappyPath(deps);
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution("run-1");

    expect(deps.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: RunEvent.EXECUTION_STARTED }),
    );
    expect(deps.gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(deps.gitService.commitAndPush).toHaveBeenCalled();
    expect(deps.runRepo.update).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ prNumber: 7, executorRuntime: "claude-code" }),
    );
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("skips git checkpoint commit when the run has no branch yet", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(
      makeRun({ state: RunState.Implementing, branchName: null }),
    );
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    deps.executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 9 });
    deps.runRepo.update.mockResolvedValue(makeRun({ prNumber: 9 }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution("run-1");

    expect(deps.gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("recovers a stranded execution report without re-running the executor", async () => {
    const deps = buildDeps();
    const run = makeRun({ state: RunState.Implementing, prNumber: 7 });
    deps.runRepo.findById.mockResolvedValue(run);
    const reportCreatedAt = new Date("2026-01-01T12:00:00Z");
    const startedAt = new Date("2026-01-01T11:00:00Z");
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan() });
      if (type === "ExecutionReport") {
        return Promise.resolve({ payloadJson: makeExecutionReport(), createdAt: reportCreatedAt });
      }
      return Promise.resolve(null);
    });
    deps.eventRepo.findByRunId.mockResolvedValue([
      { eventType: RunEvent.EXECUTION_STARTED, createdAt: startedAt },
    ]);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution("run-1");

    expect(deps.executorAgent.run).not.toHaveBeenCalled();
    expect(deps.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: RunEvent.EXECUTION_FINISHED }),
    );
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("does not take the recovery shortcut when EXECUTION_FINISHED already fired after the report", async () => {
    const deps = buildDeps();
    setupHappyPath(deps);
    const run = makeRun({ state: RunState.Implementing, prNumber: 7 });
    deps.runRepo.findById.mockResolvedValue(run);
    const reportCreatedAt = new Date("2026-01-01T12:00:00Z");
    const startedAt = new Date("2026-01-01T11:00:00Z");
    const finishedAt = new Date("2026-01-01T13:00:00Z");
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan() });
      if (type === "ExecutionReport") {
        return Promise.resolve({ payloadJson: makeExecutionReport(), createdAt: reportCreatedAt });
      }
      return Promise.resolve(null);
    });
    deps.eventRepo.findByRunId.mockResolvedValue([
      { eventType: RunEvent.EXECUTION_STARTED, createdAt: startedAt },
      { eventType: RunEvent.EXECUTION_FINISHED, createdAt: finishedAt },
    ]);

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution("run-1");

    expect(deps.executorAgent.run).toHaveBeenCalled();
  });

  it("pauses the run and notifies Linear when the executor times out", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    const timeoutError = new AgentTimeoutError("executor", 600_000);
    deps.executorAgent.run.mockRejectedValue(timeoutError);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIBlocked }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runExecution("run-1");

    expect(deps.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "EXECUTION_TIMEOUT" }),
    );
    expect(deps.runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.AIBlocked);
    expect(deps.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Executor timed out after 10 minutes"),
    );
    expect(result.state).toBe(RunState.AIBlocked);
  });

  it("propagates a non-timeout error from the executor", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    deps.executorAgent.run.mockRejectedValue(new Error("boom"));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });

  it("throws via policy when the run is not in Implementing state", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Planning }));
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(/Cannot execute/);
  });
});

describe("OrchestratorService.runReview", () => {
  function baseDeps() {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 7 }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve({ payloadJson: makeExecutionReport() });
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan() });
      return Promise.resolve(null);
    });
    deps.githubClient.getPRDiff.mockResolvedValue("diff --git a/x b/x");
    deps.runRepo.update.mockResolvedValue(
      makeRun({ state: RunState.AIReview, prNumber: 7, reviewerRuntime: "codex" }),
    );
    return deps;
  }

  it("approved verdict: transitions to REVIEW_APPROVED and marks ready", async () => {
    const deps = baseDeps();
    deps.reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));
    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    expect(deps.runRepo.updateState).toHaveBeenCalledWith(
      "run-1",
      RunState.ReadyForHumanReview,
    );
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(deps.githubSync.postReviewFindings).not.toHaveBeenCalled();
  });

  it("changes_requested verdict with findings: posts PR findings and starts remediation", async () => {
    const deps = baseDeps();
    const findings = [
      { id: "f1", severity: "blocker" as const, type: "bug", file: "a.ts", title: "t", details: "d" },
    ];
    deps.reviewerAgent.run.mockResolvedValue(
      makeReview({ overallVerdict: "changes_requested", findings }),
    );
    deps.githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 101]]));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));
    const svc = new OrchestratorService(deps as never);
    const runRemediationSpy = vi.spyOn(svc, "runRemediation").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    expect(deps.githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      7,
      findings,
      "changes_requested",
    );
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", { f1: 101 });
  });

  it("throws via policy when there is no execution report yet", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runReview("run-1")).rejects.toThrow(/Cannot review/);
  });
});

describe("OrchestratorService.runRemediation", () => {
  it("runs remediation, commits, posts updates, and marks ready on completion", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(
      makeRun({ state: RunState.AddressingReview, prNumber: 7 }),
    );
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review")
        return Promise.resolve({
          payloadJson: makeReview({
            overallVerdict: "changes_requested",
            findings: [
              {
                id: "f1",
                severity: "blocker" as const,
                type: "bug",
                file: "a.ts",
                title: "t",
                details: "d",
              },
            ],
          }),
        });
      if (type === "ExecutionReport")
        return Promise.resolve({ payloadJson: makeExecutionReport({ executionVersion: 1, score: 0.5 }) });
      return Promise.resolve(null);
    });
    deps.remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [
        { findingId: "f1", status: "accepted" as const, action: "fixed it", rationale: "was broken" },
      ],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2, score: 0.9 }),
    });
    deps.runRepo.update.mockResolvedValue(
      makeRun({ state: RunState.AddressingReview, prNumber: 7, remediationRuntime: "claude-code" }),
    );
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 7 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7 }));

    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runRemediation("run-1", { f1: 101 });

    expect(deps.gitService.commitAndPush).toHaveBeenCalled();
    expect(deps.githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      7,
      expect.objectContaining({ executionVersion: 2 }),
    );
    expect(deps.githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      7,
      expect.arrayContaining([expect.objectContaining({ findingId: "f1" })]),
      { f1: 101 },
    );
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
  });

  it("skips git commit and PR sync when there is no branch/PR", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(
      makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: null }),
    );
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review")
        return Promise.resolve({
          payloadJson: makeReview({
            overallVerdict: "changes_requested",
            findings: [
              { id: "f1", severity: "blocker" as const, type: "bug", file: "a.ts", title: "t", details: "d" },
            ],
          }),
        });
      if (type === "ExecutionReport") return Promise.resolve({ payloadJson: makeExecutionReport() });
      return Promise.resolve(null);
    });
    deps.remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [],
      readyForHumanReview: true,
      executionReport: makeExecutionReport(),
    });
    deps.runRepo.update.mockResolvedValue(
      makeRun({
        state: RunState.AddressingReview,
        branchName: null,
        prNumber: null,
        remediationRuntime: "claude-code",
      }),
    );
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, branchName: null, prNumber: null }))
      .mockResolvedValueOnce(
        makeRun({ state: RunState.ReadyForHumanReview, branchName: null, prNumber: null }),
      );

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runRemediation("run-1");

    expect(deps.gitService.commitAndPush).not.toHaveBeenCalled();
    expect(deps.githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(deps.githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });

  it("throws via policy when the review verdict is not changes_requested", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Review"
        ? Promise.resolve({ payloadJson: makeReview({ overallVerdict: "approved" }) })
        : Promise.resolve(null),
    );
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(/Cannot remediate/);
  });
});

describe("OrchestratorService.markReady", () => {
  it("asserts policy and posts the completion comment", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 7 }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review") return Promise.resolve({ payloadJson: makeReview() });
      if (type === "ExecutionReport") return Promise.resolve({ payloadJson: makeExecutionReport() });
      return Promise.resolve(null);
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.markReady("run-1");

    expect(deps.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
    expect(result.id).toBe("run-1");
  });

  it("throws via policy when there is no PR", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ prNumber: null }));
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toThrow(/Cannot mark ready/);
  });
});
