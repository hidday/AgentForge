import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
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
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
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
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
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
    scoreRationale: "All green.",
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

function buildDeps(overrides: Record<string, unknown> = {}, initialRun: Run = makeRun()) {
  let trackedRun: Run = initialRun;

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(trackedRun)),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((id: string, state: RunState) => {
      trackedRun = { ...trackedRun, id, state };
      return Promise.resolve(trackedRun);
    }),
    update: vi.fn().mockImplementation((id: string, data: Record<string, unknown>) => {
      trackedRun = { ...trackedRun, id, ...data };
      return Promise.resolve(trackedRun);
    }),
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
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn().mockResolvedValue("diff content") };

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
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    reviewerAgent,
    remediationAgent,
    githubSync,
  };
}

describe("OrchestratorService simple getters", () => {
  it("expose the injected repositories and linear client", () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    expect(svc.getRunRepo()).toBe(runRepo);
    expect(svc.getArtifactRepo()).toBe(artifactRepo);
    expect(svc.getEventRepo()).toBe(eventRepo);
    expect(svc.getLinearClient()).toBe(linearClient);
    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });
});

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating a new one", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const existing = makeRun({ id: "run-existing", state: RunState.Planning });
    runRepo.findActiveByIssueId.mockResolvedValue(existing);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(runRepo.create).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runPlanning", () => {
  it("re-plans using stored context (rejection, human answers, researched answers, plan review) and proceeds to plan review when no blockers remain", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps({}, run);
    const svc = new OrchestratorService(deps as never);

    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "RejectionContext")
        return Promise.resolve(
          makeArtifact({ type: "RejectionContext", payloadJson: { planVersion: 1, feedback: "Use X", source: "api", mode: "iterate" } }),
        );
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "HumanAnswers")
        return Promise.resolve(
          makeArtifact({ type: "HumanAnswers", payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] } }),
        );
      if (type === "ResearchedAnswers")
        return Promise.resolve(
          makeArtifact({
            type: "ResearchedAnswers",
            payloadJson: { summary: "s", answers: [{ questionId: "q1", question: "Q", answer: "A", confidence: "high" }] },
          }),
        );
      if (type === "PlanReview")
        return Promise.resolve(
          makeArtifact({
            type: "PlanReview",
            payloadJson: { summary: "review summary", findings: [{ id: "f1", severity: "important", title: "t", details: "d" }] },
          }),
        );
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(newPlan);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview").mockResolvedValue(run);

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 2,
        humanFeedback: { planVersion: 1, feedback: "Use X" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q1", question: "Q", answer: "A", confidence: "high" }],
        planReviewFindings: { summary: "review summary", findings: [{ id: "f1", severity: "important", title: "t", details: "d" }] },
      }),
    );
    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("pauses for human clarification when the re-plan still has blocking open questions", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    const { deps, artifactRepo, plannerAgent, eventRepo } = buildDeps({}, run);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Blocker?", requiredForExecution: true }] }),
    );
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(runPlanReviewSpy).not.toHaveBeenCalled();
    const eventTypes = eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
  });
});

describe("OrchestratorService.runPlanReview", () => {
  it("throws when no plan artifact exists for the run", async () => {
    const run = makeRun({ state: RunState.PlanReview });
    const { deps, artifactRepo } = buildDeps({}, run);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact/);
  });

  it("delegates to runPlanRevision and posts the review findings comment when changes are requested", async () => {
    const run = makeRun({ state: RunState.PlanReview });
    const { deps, artifactRepo, planReviewerAgent, linearClient } = buildDeps({}, run);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() })) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue({
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [{ id: "f1", severity: "important", title: "Issue", details: "Fix it", affectedStepId: "s1" }],
    });
    const revisedRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision").mockResolvedValue(revisedRun);

    const result = await svc.runPlanReview("run-1");

    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBe(revisedRun);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Changes Requested"),
    );
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("persists the revised plan version, transitions to AwaitingPlanApproval, and posts a disposition comment", async () => {
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const { deps, artifactRepo, planReviserAgent, linearClient } = buildDeps({}, run);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "PlanReview")
        return Promise.resolve(
          makeArtifact({ type: "PlanReview", payloadJson: { overallVerdict: "changes_requested", summary: "s", findings: [] } }),
        );
      return Promise.resolve(null);
    });
    const revisedPlan = makePlan({ planVersion: 2 });
    planReviserAgent.run.mockResolvedValue({
      revision: {
        dispositions: [{ findingId: "f1", status: "accepted", rationale: "Makes sense" }],
      },
      revisedPlan,
    });

    const result = await svc.runPlanRevision("run-1", { note: "please simplify step 1" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "please simplify step 1" },
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Plan Revision Dispositions"),
    );
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("throws when no plan artifact exists", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, artifactRepo } = buildDeps({}, run);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact/);
  });

  it("records approvedPlanVersion, transitions to Implementing, and posts an approval comment including the operator note", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, artifactRepo, linearClient } = buildDeps({}, run);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 3 }) })) : Promise.resolve(null),
    );

    const result = await svc.approvePlan("run-1", { note: "ship it" });

    expect(result.state).toBe(RunState.Implementing);
    expect(result.approvedPlanVersion).toBe(3);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("ship it"),
    );
  });

  it("posts an approval comment without a note suffix when none is provided", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, artifactRepo, linearClient } = buildDeps({}, run);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) })) : Promise.resolve(null),
    );

    await svc.approvePlan("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v1 approved. Starting implementation...",
    );
  });
});

describe("OrchestratorService.runReview", () => {
  it("transitions to AddressingReview and runs remediation when the reviewer requests changes, posting review findings to GitHub", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 11 });
    const { deps, artifactRepo, reviewerAgent, githubSync, remediationAgent } = buildDeps({}, run);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: makeReview({
              overallVerdict: "changes_requested",
              findings: [{ id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" }],
            }),
          }),
        );
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(
      makeReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" }],
      }),
    );
    githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 101]]));
    remediationAgent.run.mockRejectedValue(new Error("stop-after-remediation-dispatch"));

    await expect(svc.runReview("run-1")).rejects.toThrow("stop-after-remediation-dispatch");

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      11,
      expect.anything(),
      "changes_requested",
    );
    expect(remediationAgent.run).toHaveBeenCalled();
  });

  it("transitions to ReadyForHumanReview and calls markReady when the reviewer approves", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 11 });
    const { deps, artifactRepo, reviewerAgent, linearClient } = buildDeps({}, run);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: makeReview() }));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));

    const result = await svc.runReview("run-1");

    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
  });
});

describe("OrchestratorService.runRemediation", () => {
  it("commits the fix and posts execution-report/resolution comments and GitHub updates before markReady re-validates the (still changes_requested) Review", async () => {
    // Known pre-existing behaviour (also documented in
    // orchestratorService.executionScore.test.ts): runRemediation always
    // chains into markReady, but does not itself produce a fresh *approved*
    // Review artifact, so assertCanMarkReady throws on the stale verdict.
    // This test asserts that every remediation side effect still lands
    // before that throw.
    const run = makeRun({ state: RunState.AddressingReview, prNumber: 11 });
    const { deps, artifactRepo, remediationAgent, linearClient, githubSync } = buildDeps({}, run);
    const svc = new OrchestratorService(deps as never);

    const newReport = makeExecutionReport({ executionVersion: 2, score: 0.95 });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: makeReview({
              overallVerdict: "changes_requested",
              findings: [{ id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" }],
            }),
          }),
        );
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });
    remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "Fixed", rationale: "Real bug" }],
      readyForHumanReview: true,
      executionReport: newReport,
    });

    await expect(svc.runRemediation("run-1", { f1: 42 })).rejects.toThrow(
      /ready_requires_approved_verdict|approved/,
    );

    expect(linearClient.postComment).toHaveBeenCalledWith("LIN-1", expect.stringContaining("Remediation Summary"));
    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith("test-repo", 11, newReport);
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      11,
      [{ findingId: "f1", status: "accepted", action: "Fixed", rationale: "Real bug" }],
      { f1: 42 },
    );
  });
});

describe("OrchestratorService.markReady", () => {
  it("throws via the policy engine when checks have not passed", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
    const { deps, artifactRepo } = buildDeps({}, run);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(
          makeArtifact({
            type: "ExecutionReport",
            payloadJson: makeExecutionReport({
              checks: {
                lint: { status: "pass", details: "ok" },
                typecheck: { status: "pass", details: "ok" },
                tests: { status: "fail", details: "regression" },
              },
            }),
          }),
        );
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: makeReview() }));
      return Promise.resolve(null);
    });

    await expect(svc.markReady("run-1")).rejects.toThrow(/failing checks/);
  });

  it("posts the final completion comment when the policy checks pass", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
    const { deps, artifactRepo, linearClient } = buildDeps({}, run);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: makeReview() }));
      return Promise.resolve(null);
    });

    const result = await svc.markReady("run-1");

    expect(result).toBeDefined();
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
  });
});
