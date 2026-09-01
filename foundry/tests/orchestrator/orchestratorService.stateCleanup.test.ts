import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, RunEventRecord } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: 42,
    state: RunState.ReadyForHumanReview,
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

function buildDeps(opts: {
  finalState: RunState;
  events?: RunEventRecord[];
  mainRepoPath?: string;
  workingDirectory?: string;
  agentSkillRepo?: Record<string, unknown>;
}) {
  const readyRun = makeRun({
    state: RunState.ReadyForHumanReview,
    workingDirectory: opts.workingDirectory ?? "/tmp/worktree",
  });
  const finishedRun = { ...readyRun, state: opts.finalState };

  const runRepo = {
    findById: vi.fn().mockResolvedValue(readyRun),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockResolvedValue(finishedRun),
    update: vi.fn(),
  };

  const artifactRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn(), findLatestByType: vi.fn().mockResolvedValue(null) };
  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
    findByRunId: vi.fn().mockResolvedValue(opts.events ?? []),
  };
  const linearClient = { getIssue: vi.fn(), postComment: vi.fn().mockResolvedValue(undefined) };
  const githubClient = { getPRDiff: vi.fn() };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
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
    assertBranch: vi.fn(),
    commitAndPush: vi.fn(),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue(opts.mainRepoPath ?? "/repo/main"),
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
      ...(opts.agentSkillRepo ? { agentSkillRepo: opts.agentSkillRepo } : {}),
    },
    runRepo,
    eventRepo,
    gitService,
    logger,
  };
}

describe("OrchestratorService transitionAndRecord side effects on Done/Failed", () => {
  it("removes the run worktree when the working directory differs from the main repo path", async () => {
    const built = buildDeps({
      finalState: RunState.Done,
      mainRepoPath: "/repo/main",
      workingDirectory: "/repo/main/.worktrees/run-1",
    });
    built.gitService.resolveMainRepoPath.mockReturnValue("/repo/main");

    const svc = new OrchestratorService(built.deps as never);
    await svc.approveHumanReview("run-1");

    expect(built.gitService.removeWorktree).toHaveBeenCalledWith(
      "/repo/main",
      "/repo/main/.worktrees/run-1",
    );
  });

  it("skips worktree removal when the working directory equals the resolved main repo path", async () => {
    const built = buildDeps({
      finalState: RunState.Done,
      mainRepoPath: "/repo/main",
      workingDirectory: "/repo/main",
    });
    built.gitService.resolveMainRepoPath.mockReturnValue("/repo/main");

    const svc = new OrchestratorService(built.deps as never);
    await svc.approveHumanReview("run-1");

    expect(built.gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("increments success and archives low-utility skills when the run finishes as Done", async () => {
    const skill = { id: "skill-1", successCount: 4, failureCount: 1, utilityScore: 0.1 };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockResolvedValue(skill),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const built = buildDeps({
      finalState: RunState.Done,
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-1", "skill-2"] },
          createdAt: new Date(),
        },
        {
          id: "e2",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-2"] },
          createdAt: new Date(),
        },
      ],
      agentSkillRepo,
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.approveHumanReview("run-1");

    // Deduplicated across the two SKILL_INJECTION events -> 2 unique skill ids.
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(skill);
  });

  it("increments failure metrics for injected skills when the run finishes as Failed (clarification exhausted)", async () => {
    // approveHumanReview can only ever drive the run to Done (ReadyForHumanReview
    // -> Done is the only transition HUMAN_APPROVED supports), so to exercise the
    // Failed branch of transitionAndRecord's cleanup we go through the
    // clarification-exhausted path instead (HumanClarificationNeeded -> Failed).
    const skill = { id: "skill-1", successCount: 0, failureCount: 1, utilityScore: 0 };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockResolvedValue(skill),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };

    const clarificationRun = makeRun({
      state: RunState.HumanClarificationNeeded,
      workingDirectory: "/tmp/worktree",
    });
    const planningRun = { ...clarificationRun, state: RunState.Planning };
    const planReviewRun = { ...clarificationRun, state: RunState.PlanReview };
    const failedRun = { ...clarificationRun, state: RunState.Failed };

    const runRepo = {
      findById: vi.fn().mockResolvedValue(clarificationRun),
      findActiveByIssueId: vi.fn(),
      findAll: vi.fn(),
      create: vi.fn(),
      findByIssueId: vi.fn(),
      updateState: vi
        .fn()
        .mockResolvedValueOnce(planningRun) // CLARIFICATION_PROVIDED
        .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
        .mockResolvedValueOnce(failedRun), // CLARIFICATION_EXHAUSTED
      update: vi.fn().mockResolvedValue({ ...planningRun, planVersion: 2 }),
    };

    const plan = {
      planVersion: 1,
      summary: "s",
      requirementsTraceability: "",
      assumptions: [],
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
      risks: [],
      steps: [{ id: "s1", title: "t", description: "d" }],
      testPlan: "t",
      confidence: 0.9,
    };
    const taskBundle = {
      issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
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
    const newPlan = { ...plan, planVersion: 2, openQuestions: [{ ...plan.openQuestions[0] }] };

    const artifactRepo = {
      create: vi.fn().mockResolvedValue({}),
      findByRunId: vi.fn(),
      findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") {
          return Promise.resolve({
            id: "a1", runId: "run-1", type: "Plan", version: 1, payloadJson: plan,
            rawText: "{}", createdAt: new Date(),
          });
        }
        if (type === "TaskBundle") {
          return Promise.resolve({
            id: "a2", runId: "run-1", type: "TaskBundle", version: 1, payloadJson: taskBundle,
            rawText: "{}", createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      }),
    };

    const priorEvents: RunEventRecord[] = [
      { id: "e1", runId: "run-1", eventType: "NEEDS_HUMAN_CLARIFICATION", source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e2", runId: "run-1", eventType: "NEEDS_HUMAN_CLARIFICATION", source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e3", runId: "run-1", eventType: "NEEDS_HUMAN_CLARIFICATION", source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      {
        id: "e4",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] },
        createdAt: new Date(),
      },
    ];
    const eventRepo = {
      create: vi.fn().mockResolvedValue({}),
      findByRunId: vi.fn().mockResolvedValue(priorEvents),
    };

    const linearClient = { getIssue: vi.fn(), postComment: vi.fn().mockResolvedValue(undefined) };
    const githubClient = { getPRDiff: vi.fn() };
    const repoRegistry = {
      resolveForIssue: vi.fn(),
      resolveWorkingDirectory: vi.fn(),
      validateWorkingDirectory: vi.fn(),
      getRepoByName: vi.fn(),
      getDefaultRepo: vi.fn(),
    };
    const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
    const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };
    const plannerAgent = { run: vi.fn().mockResolvedValue(newPlan) };
    const gitService = {
      setupRunWorktree: vi.fn(),
      assertBranch: vi.fn(),
      commitAndPush: vi.fn(),
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

    const svc = new OrchestratorService({
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
      planReviewerAgent: { run: vi.fn() },
      planReviserAgent: { run: vi.fn() },
      executorAgent: { run: vi.fn() },
      reviewerAgent: { run: vi.fn() },
      remediationAgent: { run: vi.fn() },
      logger,
      dashboardEmitter,
      agentSkillRepo,
    } as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still confused" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(gitService.removeWorktree).toHaveBeenCalled();
  });

  it("does nothing when there is no agentSkillRepo configured", async () => {
    const built = buildDeps({
      finalState: RunState.Done,
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-1"] },
          createdAt: new Date(),
        },
      ],
    });

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.approveHumanReview("run-1")).resolves.toBeDefined();
    // No agentSkillRepo means updateSkillMetrics returns immediately; nothing
    // to assert on directly beyond "it did not throw".
  });

  it("does nothing when there are no SKILL_INJECTION events for the run", async () => {
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const built = buildDeps({ finalState: RunState.Done, events: [], agentSkillRepo });

    const svc = new OrchestratorService(built.deps as never);
    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });

  it("logs a warning and continues when incrementing a skill metric throws", async () => {
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockRejectedValue(new Error("db unavailable")),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const built = buildDeps({
      finalState: RunState.Done,
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-1"] },
          createdAt: new Date(),
        },
      ],
      agentSkillRepo,
    });

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.approveHumanReview("run-1")).resolves.toBeDefined();

    const warnCall = built.logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Failed to update skill metric"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { skillId: string; error: string }).skillId).toBe("skill-1");
    expect((warnCall![0] as { skillId: string; error: string }).error).toBe("db unavailable");
  });
});
