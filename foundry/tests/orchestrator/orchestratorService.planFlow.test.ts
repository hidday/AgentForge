import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

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
    state: RunState.Planning,
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

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "pr-1",
    summary: "Solid plan",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeTaskBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "Test", description: "d", labels: [], priority: 0 },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/run-1",
      repoPath: "/tmp",
      allowedPaths: ["src/"],
      protectedPaths: [],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: [],
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

/**
 * Builds a runRepo backed by a mutable `store.run`, so that every call to
 * `transitionAndRecord` inside the service sees the *actual* current state
 * (kept in sync by updateState/update) rather than a stale value baked into
 * a one-shot mock. This lets tests exercise the real stateMachine.transition()
 * logic across multi-step flows without hand-sequencing mockResolvedValueOnce
 * chains for every intermediate state.
 */
function buildDeps(initialRun: Run) {
  const store: { run: Run } = { run: initialRun };

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.run = { ...store.run, state: newState };
      return Promise.resolve({ ...store.run });
    }),
    update: vi.fn().mockImplementation((_id: string, data: Partial<Run>) => {
      store.run = { ...store.run, ...data };
      return Promise.resolve({ ...store.run });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
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
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = {
    getPRDiff: vi.fn(),
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
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
    postExecutionReportUpdate: vi.fn(),
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
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    gitService,
    logger,
    store,
  };
}

describe("OrchestratorService.approvePlan", () => {
  it("stamps approvedPlanVersion, transitions to Implementing, and posts a plain approval comment", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps(
      makeRun({ state: RunState.AwaitingPlanApproval }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 2 }) }),
    );

    const result = await svc.approvePlan("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 2 });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      expect.any(String),
      "Plan v2 approved. Starting implementation...",
    );
    expect(result.state).toBe(RunState.Implementing);
  });

  it("includes the operator note in the approval comment when provided", async () => {
    const { deps, artifactRepo, linearClient } = buildDeps(
      makeRun({ state: RunState.AwaitingPlanApproval }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }),
    );

    await svc.approvePlan("run-1", { note: "prioritize backwards compat" });

    expect(linearClient.postComment).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("prioritize backwards compat"),
    );
  });

  it("throws when there is no Plan artifact", async () => {
    const { deps, artifactRepo } = buildDeps(makeRun({ state: RunState.AwaitingPlanApproval }));
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.runPlanReview", () => {
  it("approves the plan and posts an 'approved' comment without triggering revision", async () => {
    const { deps, artifactRepo, planReviewerAgent, linearClient } = buildDeps(
      makeRun({ state: RunState.PlanReview }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const result = await svc.runPlanReview("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("AI plan review: approved"),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("requests changes and delegates to runPlanRevision", async () => {
    const { deps, artifactRepo, planReviewerAgent } = buildDeps(makeRun({ state: RunState.PlanReview }));
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "risk", title: "t", details: "d" }],
      }),
    );
    const revisedRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision").mockResolvedValue(revisedRun);

    const result = await svc.runPlanReview("run-1");

    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBe(revisedRun);
  });

  it("throws when there is no Plan artifact", async () => {
    const { deps, artifactRepo } = buildDeps(makeRun({ state: RunState.PlanReview }));
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, updates planVersion, transitions to AwaitingPlanApproval, and posts a combined comment", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent, linearClient } = buildDeps(
      makeRun({ state: RunState.PlanRevision }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "PlanReview")
        return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: makePlanReview() }));
      return Promise.resolve(null);
    });
    planReviserAgent.run.mockResolvedValue({
      revision: {
        dispositions: [{ findingId: "f1", status: "accepted", rationale: "Fair point" }],
      },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const result = await svc.runPlanRevision("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("Plan Revision Dispositions"),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("forwards an operator note to the plan reviser agent", async () => {
    const { deps, artifactRepo, planReviserAgent } = buildDeps(makeRun({ state: RunState.PlanRevision }));
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "PlanReview")
        return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: makePlanReview() }));
      return Promise.resolve(null);
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    await svc.runPlanRevision("run-1", { note: "keep it minimal" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "keep it minimal" },
    );
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("returns to AwaitingPlanApproval when the reviewer approves", async () => {
    const { deps, artifactRepo, planReviewerAgent } = buildDeps(
      makeRun({ state: RunState.AwaitingPlanApproval }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("still returns to AwaitingPlanApproval (not PlanRevision) when the reviewer requests changes", async () => {
    const { deps, artifactRepo, planReviewerAgent } = buildDeps(
      makeRun({ state: RunState.AwaitingPlanApproval }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "risk", title: "t", details: "d" }],
      }),
    );

    const result = await svc.runManualReReview("run-1", { note: "double check auth" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "double check auth" },
    );
  });

  it("throws when there is no Plan artifact", async () => {
    const { deps, artifactRepo } = buildDeps(makeRun({ state: RunState.AwaitingPlanApproval }));
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("does not revise when the reviewer approves", async () => {
    const { deps, artifactRepo, planReviewerAgent } = buildDeps(
      makeRun({ state: RunState.AwaitingPlanApproval }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision");

    const result = await svc.runManualPlanRevision("run-1");

    expect(runPlanRevisionSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("delegates to runPlanRevision (forwarding the note) when the reviewer requests changes", async () => {
    const { deps, artifactRepo, planReviewerAgent } = buildDeps(
      makeRun({ state: RunState.AwaitingPlanApproval }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "risk", title: "t", details: "d" }],
      }),
    );
    const revisedRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision").mockResolvedValue(revisedRun);

    const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1", { note: "tighten scope" });
    expect(result).toBe(revisedRun);
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName yet", async () => {
    const { deps, artifactRepo, plannerAgent, gitService } = buildDeps(
      makeRun({ state: RunState.Todo, branchName: null }),
    );
    const svc = new OrchestratorService(deps as never);

    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const runPlanReviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalled();
    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const { deps, artifactRepo, plannerAgent, gitService } = buildDeps(
      makeRun({ state: RunState.Todo, branchName: "ai/existing" }),
    );
    const svc = new OrchestratorService(deps as never);

    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    artifactRepo.findLatestByType.mockResolvedValue(null);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for clarification when the plan has blocking questions", async () => {
    const { deps, artifactRepo, plannerAgent } = buildDeps(
      makeRun({ state: RunState.Todo, branchName: "ai/existing" }),
    );
    const svc = new OrchestratorService(deps as never);

    plannerAgent.run.mockResolvedValue(
      makePlan({ openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }] }),
    );
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.retryRun("run-1");

    expect(runPlanReviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.runPlanning", () => {
  it("re-plans using stored context artifacts and proceeds to plan review when unblocked", async () => {
    const { deps, artifactRepo, plannerAgent } = buildDeps(
      makeRun({ state: RunState.Planning, planVersion: 1 }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "RejectionContext")
        return Promise.resolve(
          makeArtifact({
            type: "RejectionContext",
            payloadJson: { planVersion: 1, feedback: "Use OAuth2", source: "api", mode: "iterate" },
          }),
        );
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "HumanAnswers")
        return Promise.resolve(
          makeArtifact({ type: "HumanAnswers", payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] } }),
        );
      if (type === "ResearchedAnswers") return Promise.resolve(null);
      if (type === "PlanReview")
        return Promise.resolve(
          makeArtifact({
            type: "PlanReview",
            payloadJson: { summary: "prior findings", findings: [] },
          }),
        );
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
    const runPlanReviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 2,
        humanFeedback: { planVersion: 1, feedback: "Use OAuth2" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        planReviewFindings: { summary: "prior findings", findings: [] },
      }),
    );
    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("pauses for clarification when the re-plan still has blocking questions", async () => {
    const { deps, artifactRepo, plannerAgent } = buildDeps(
      makeRun({ state: RunState.Planning, planVersion: 1 }),
    );
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }] }),
    );
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.runPlanning("run-1");

    expect(runPlanReviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});
