import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

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

  const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }), findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
      project: "test-project",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
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
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };
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
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    planReviewerAgent,
    gitService,
    logger,
  };
}

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without re-planning when one already exists for the issue", async () => {
    const { deps, runRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const existing = makeRun({ id: "run-existing", state: RunState.Planning });
    runRepo.findActiveByIssueId.mockResolvedValue(existing);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(linearClient.getIssue).not.toHaveBeenCalled();
    expect(runRepo.create).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runPlanReview", () => {
  it("throws when no plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("posts the plan-review comment and delegates to runPlanRevision when changes are requested", async () => {
    const { deps, runRepo, artifactRepo, linearClient, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.PlanReview });
    const plan = makePlan();

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: plan }));
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "Needs work",
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "blocker", type: "gap", title: "Missing tests", details: "Add tests", affectedStepId: "s1" },
      ],
    });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));

    const runPlanRevisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const result = await svc.runPlanReview("run-1");

    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.PlanRevision);
    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("AI Plan Review"),
    );
    expect(comment).toBeDefined();
    expect(comment![1]).toContain("Changes Requested");
    expect(comment![1]).toContain("Missing tests");
    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.rejectPlan -- re-plan context branches", () => {
  it("passes humanAnswers, researchedAnswers, and planReviewFindings from loadReplanContext when iterating", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    const plannerAgent = deps.plannerAgent;
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const humanAnswers = [{ questionId: "q1", answer: "yes" }];
    const researchedAnswers = [{ questionId: "q2", question: "q", answer: "a", confidence: "high" as const }];
    const planReviewFindings = { summary: "s", findings: [{ id: "f1", severity: "blocker", title: "t", details: "d" }] };

    runRepo.findById
      .mockResolvedValueOnce(run) // requireRun inside rejectPlan
      .mockResolvedValue(makeRun({ ...run, state: RunState.PlanReview, planVersion: 2 })); // requireRun inside runPlanReview
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, planVersion: 1 })) // PLAN_REJECTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 })); // PLAN_REVIEW_APPROVED
    runRepo.update.mockResolvedValue({ ...run, state: RunState.Planning, planVersion: 2 });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "HumanAnswers") return Promise.resolve(makeArtifact({ type: "HumanAnswers", payloadJson: { answers: humanAnswers } }));
      if (type === "ResearchedAnswers") return Promise.resolve(makeArtifact({ type: "ResearchedAnswers", payloadJson: { summary: "s", answers: researchedAnswers, completedAt: new Date().toISOString() } }));
      if (type === "PlanReview") return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: planReviewFindings }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2 }));
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] });

    await svc.rejectPlan("run-1", undefined, "api", "iterate");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanAnswers,
        researchedAnswers,
        planReviewFindings,
      }),
    );
  });

  it("pauses for human clarification when the re-plan after rejection still has blocking questions", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const plannerAgent = deps.plannerAgent;
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning })) // PLAN_REJECTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded })); // NEEDS_HUMAN_CLARIFICATION
    runRepo.update.mockResolvedValue({ ...run, state: RunState.Planning, planVersion: 2 });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }] }),
    );

    const result = await svc.rejectPlan("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.answerQuestions -- additional guard/loop branches", () => {
  it("throws when no plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.HumanClarificationNeeded }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.answerQuestions("run-1", [])).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("throws when no TaskBundle artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Planning }));

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow("No TaskBundle artifact found for run run-1");
  });

  it("loops back to HumanClarificationNeeded (not yet exhausted) when blockers remain after re-planning", async () => {
    const { deps, runRepo, artifactRepo, eventRepo } = buildDeps();
    const plannerAgent = deps.plannerAgent;
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const taskBundle = {
      issue: { id: "LIN-1", title: "Test", description: "Test", labels: [], priority: 0 },
      repo: { name: "test-repo", defaultBranch: "main", workingBranch: "ai/lin-1", repoPath: "/tmp", allowedPaths: ["src/"], protectedPaths: [] },
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
      definitionOfDone: [],
    };
    const stillBlockingPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }],
    });

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning })) // CLARIFICATION_PROVIDED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded })); // NEEDS_HUMAN_CLARIFICATION (loop back)
    runRepo.update.mockResolvedValue({ ...run, state: RunState.Planning, planVersion: 2 });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "TaskBundle") return Promise.resolve(makeArtifact({ type: "TaskBundle", payloadJson: taskBundle }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(stillBlockingPlan);
    // Only 1 prior NEEDS_HUMAN_CLARIFICATION event -- below MAX_CLARIFICATION_ITERATIONS (3).
    eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
    ]);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "partial" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const loopBackEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as { eventType: string }).eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION,
    );
    expect(loopBackEvent).toBeDefined();
    expect((loopBackEvent![0] as { payloadJson: { iteration: number } }).payloadJson.iteration).toBe(2);
  });
});

describe("OrchestratorService.runManualPlanRevision -- guard branch", () => {
  it("throws when no plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });
});

describe("OrchestratorService -- cleanupRunWorktree on terminal transitions", () => {
  it("removes the worktree when the run's workingDirectory differs from the resolved main repo path", async () => {
    const { deps, runRepo, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree-run-1" });

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done, workingDirectory: "/tmp/worktree-run-1" }));
    gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-repo");

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).toHaveBeenCalledWith("/tmp/main-repo", "/tmp/worktree-run-1");
  });

  it("does not attempt worktree removal when workingDirectory already equals the main repo path", async () => {
    const { deps, runRepo, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp" });

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done, workingDirectory: "/tmp" }));
    gitService.resolveMainRepoPath.mockReturnValue("/tmp");

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });
});
