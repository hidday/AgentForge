import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, RunEventRecord, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
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
    state: RunState.ReadyForHumanReview,
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

function skillInjectionEvent(skillIds: string[] | undefined): RunEventRecord {
  return {
    id: `evt-${skillIds ? skillIds.join("-") : "none"}`,
    runId: "run-1",
    eventType: "SKILL_INJECTION",
    source: "orchestrator",
    payloadJson: skillIds === undefined ? {} : { skillIds },
    createdAt: new Date(),
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Test plan",
    assumptions: [],
    openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeTaskBundle(): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      labels: [],
      priority: 0,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
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

function asArtifact(overrides: {
  type: Artifact["type"];
  version: number;
  payloadJson: unknown;
}): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version}`,
    runId: "run-1",
    type: overrides.type,
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: new Date(),
  };
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  let current: Run = makeRun();

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(current)),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      current = { ...current, state: newState };
      return Promise.resolve(current);
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      current = { ...current, ...patch };
      return Promise.resolve(current);
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
    getIssue: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn() };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

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

  const agentSkillRepo = {
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn().mockImplementation((id: string) =>
      Promise.resolve({ id, successCount: 1, failureCount: 0, utilityScore: 0.5 }),
    ),
    incrementFailure: vi.fn().mockImplementation((id: string) =>
      Promise.resolve({ id, successCount: 0, failureCount: 1, utilityScore: 0.0 }),
    ),
    archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
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
      distillationAgent,
      agentSkillRepo,
      logger,
      dashboardEmitter,
      ...overrides,
    },
    setRun: (run: Run) => {
      current = run;
    },
    runRepo,
    artifactRepo,
    eventRepo,
    gitService,
    agentSkillRepo,
    distillationAgent,
    logger,
  };
}

// updateSkillMetrics is private; it is only reachable indirectly when a run
// transitions into Done or Failed (see transitionAndRecord). approveHumanReview
// is the simplest public entry point in this assignment that reaches Done.
describe("OrchestratorService -- updateSkillMetrics (via approveHumanReview -> Done)", () => {
  it("no-ops when agentSkillRepo is not configured", async () => {
    const { deps, setRun } = buildDeps({ agentSkillRepo: undefined });
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun({ state: RunState.ReadyForHumanReview }));

    // Should not throw even though no agentSkillRepo is present.
    const result = await svc.approveHumanReview("run-1");
    expect(result.state).toBe(RunState.Done);
  });

  it("no-ops when there are no SKILL_INJECTION events for the run", async () => {
    const { deps, setRun, eventRepo, agentSkillRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun({ state: RunState.ReadyForHumanReview }));
    eventRepo.findByRunId.mockResolvedValue([]);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });

  it("routes to incrementSuccess for each unique injected skill id and archives low-utility skills, on a successful (Done) outcome", async () => {
    const { deps, setRun, eventRepo, agentSkillRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun({ state: RunState.ReadyForHumanReview }));

    // Two injection events across the run's lifecycle (e.g. initial plan + a
    // re-plan), with an overlapping skill id that must be de-duplicated.
    eventRepo.findByRunId.mockResolvedValue([
      skillInjectionEvent(["skill-a", "skill-b"]),
      skillInjectionEvent(["skill-b", "skill-c"]),
    ]);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(3);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-a");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-b");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-c");
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(3);
  });

  it("swallows a per-skill error (e.g. skill deleted) and continues updating the rest", async () => {
    const { deps, setRun, eventRepo, agentSkillRepo, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun({ state: RunState.ReadyForHumanReview }));

    eventRepo.findByRunId.mockResolvedValue([skillInjectionEvent(["skill-a", "skill-b"])]);
    agentSkillRepo.incrementSuccess.mockImplementation((id: string) => {
      if (id === "skill-a") return Promise.reject(new Error("not found"));
      return Promise.resolve({ id, successCount: 1, failureCount: 0, utilityScore: 0.5 });
    });

    const result = await svc.approveHumanReview("run-1");

    // The run still completes despite the metric-update failure.
    expect(result.state).toBe(RunState.Done);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-a");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-b");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-a", error: "not found" }),
      "Failed to update skill metric",
    );
  });

  it("swallows a non-Error thrown value by stringifying it", async () => {
    const { deps, setRun, eventRepo, agentSkillRepo, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun({ state: RunState.ReadyForHumanReview }));

    eventRepo.findByRunId.mockResolvedValue([skillInjectionEvent(["skill-a"])]);
    agentSkillRepo.incrementSuccess.mockRejectedValue("plain string failure");

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-a", error: "plain string failure" }),
      "Failed to update skill metric",
    );
  });

  it("defaults to an empty skill id list when an injection event's payload has no skillIds", async () => {
    const { deps, setRun, eventRepo, agentSkillRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    setRun(makeRun({ state: RunState.ReadyForHumanReview }));

    // A malformed / legacy SKILL_INJECTION event with no skillIds field at all.
    eventRepo.findByRunId.mockResolvedValue([skillInjectionEvent(undefined)]);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });
});

// The Failed outcome (success=false, routing to incrementFailure) is only reachable,
// among this assignment's methods, via answerQuestions' clarification-exhausted path.
describe("OrchestratorService -- updateSkillMetrics (via answerQuestions -> Failed)", () => {
  function buildFailedRunDeps() {
    const built = buildDeps();
    return built;
  }

  it("routes to incrementFailure for injected skills when the run ends in Failed", async () => {
    const built = buildFailedRunDeps();
    const { deps, runRepo, artifactRepo, eventRepo, agentSkillRepo } = built;
    const plannerAgent = deps.plannerAgent as { run: ReturnType<typeof vi.fn> };
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const taskBundle = makeTaskBundle();
    const newPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }],
    });

    const planningRun = makeRun({ state: RunState.Planning });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 2 });
    const failedRun = makeRun({ state: RunState.Failed, planVersion: 2 });

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // CLARIFICATION_PROVIDED
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
      .mockResolvedValueOnce(failedRun); // CLARIFICATION_EXHAUSTED -> Failed
    runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 2 });

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact({ type: "Plan", version: 1, payloadJson: plan }));
      if (type === "TaskBundle") return Promise.resolve(asArtifact({ type: "TaskBundle", version: 1, payloadJson: taskBundle }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(newPlan);

    // 3 prior clarification events (exhausts MAX_CLARIFICATION_ITERATIONS) plus a
    // SKILL_INJECTION event recording an earlier skill injection for this run.
    eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e2", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e3", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      skillInjectionEvent(["skill-x"]),
    ]);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unsure" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-x");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(1);
  });
});
