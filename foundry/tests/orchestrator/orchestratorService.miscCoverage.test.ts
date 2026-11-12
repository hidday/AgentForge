import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord, SkillDocument } from "../../src/domain/types.js";
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
    branchName: "ai/run-1",
    prNumber: null,
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

function asArtifact(type: string, version: number, payloadJson: unknown): Artifact {
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

function asEvent(eventType: string, payloadJson: unknown = {}): RunEventRecord {
  return {
    id: `event-${eventType}-${Math.random()}`,
    runId: "run-1",
    eventType,
    source: "orchestrator",
    payloadJson,
    createdAt: new Date(),
  };
}

function makeSkill(id: string): SkillDocument {
  return {
    id,
    repoSlug: "test-repo",
    name: "A skill",
    description: "desc",
    taskCategory: "general",
    skillMarkdown: "# skill",
    utilityScore: 0.5,
    lastUsedAt: new Date(),
  };
}

interface TestStore {
  runState: RunState;
}

function buildDeps(initialRun: Run, store: TestStore, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, state: store.runState }),
    ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, state: newState });
    }),
    update: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, state: store.runState }),
    ),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockResolvedValue(null),
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
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
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
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] }),
  };
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
    plannerAgent,
    planReviewerAgent,
    gitService,
    logger,
    dashboardEmitter,
  };
}

describe("OrchestratorService.approveHumanReview", () => {
  it("runs the distillation agent, transitions to Done, cleans up the worktree, and posts the completion comment", async () => {
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree-xyz" });
    const store: TestStore = { runState: RunState.ReadyForHumanReview };
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
    const { deps, linearClient, gitService } = buildDeps(initialRun, store, { distillationAgent });
    const svc = new OrchestratorService(deps as never);

    // Different from workingDirectory, so cleanupRunWorktree actually removes it.
    gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-repo");

    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    expect(result.state).toBe(RunState.Done);
    expect(gitService.removeWorktree).toHaveBeenCalledWith("/tmp/main-repo", "/tmp/worktree-xyz");
    const doneComment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("**Done**"),
    );
    expect(doneComment).toBeDefined();
  });

  it("does not clean up the worktree when the resolved main repo path equals the working directory", async () => {
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree" });
    const store: TestStore = { runState: RunState.ReadyForHumanReview };
    const { deps, gitService } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    // Default mock: resolveMainRepoPath returns "/tmp/worktree", same as workingDirectory.
    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("swallows a distillation agent failure (best-effort) and still completes the run", async () => {
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const store: TestStore = { runState: RunState.ReadyForHumanReview };
    const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("distillation blew up")) };
    const { deps, logger } = buildDeps(initialRun, store, { distillationAgent });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    const warnCall = logger.warn.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Distillation agent failed"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { error: string }).error).toBe("distillation blew up");
  });

  it("completes the run even without a distillationAgent dependency configured", async () => {
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const store: TestStore = { runState: RunState.ReadyForHumanReview };
    const { deps } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });
});

describe("OrchestratorService.buildTaskBundle -- remote default branch override", () => {
  it("uses the remote GitHub default branch and logs a warning when it differs from the configured value", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store: TestStore = { runState: RunState.AwaitingPlanApproval };
    const { deps, artifactRepo, githubClient, plannerAgent, logger } = buildDeps(
      initialRun,
      store,
    );
    const svc = new OrchestratorService(deps as never);

    githubClient.getDefaultBranch.mockResolvedValue("trunk");
    const newPlan = makePlan({ planVersion: 2 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? asArtifact("Plan", 2, newPlan) : null),
    );
    plannerAgent.run.mockResolvedValue(newPlan);

    await svc.rejectPlan("run-1");

    const plannerCall = plannerAgent.run.mock.calls[0];
    const passedBundle = plannerCall[0] as { repo: { defaultBranch: string } };
    expect(passedBundle.repo.defaultBranch).toBe("trunk");

    const warnCall = logger.warn.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("differs from GitHub"),
    );
    expect(warnCall).toBeDefined();
  });

  it("falls back to the configured default branch and logs a warning when getDefaultBranch throws", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store: TestStore = { runState: RunState.AwaitingPlanApproval };
    const { deps, artifactRepo, githubClient, plannerAgent, logger } = buildDeps(
      initialRun,
      store,
    );
    const svc = new OrchestratorService(deps as never);

    githubClient.getDefaultBranch.mockRejectedValue(new Error("GitHub unavailable"));
    const newPlan = makePlan({ planVersion: 2 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? asArtifact("Plan", 2, newPlan) : null),
    );
    plannerAgent.run.mockResolvedValue(newPlan);

    await svc.rejectPlan("run-1");

    const plannerCall = plannerAgent.run.mock.calls[0];
    const passedBundle = plannerCall[0] as { repo: { defaultBranch: string } };
    expect(passedBundle.repo.defaultBranch).toBe("main");

    const warnCall = logger.warn.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Failed to resolve default branch"),
    );
    expect(warnCall).toBeDefined();
  });
});

describe("OrchestratorService -- skill retrieval and metrics", () => {
  it("retrieveSkillsForPlanning fetches top-K skills, injects them into the planner call, and records a SKILL_INJECTION event", async () => {
    const initialRun = makeRun({
      state: RunState.AwaitingPlanApproval,
      planVersion: 1,
      linearIssueTitle: "Fix the thing",
      linearIssueDescription: "A longer description of the bug",
    });
    const store: TestStore = { runState: RunState.AwaitingPlanApproval };
    const skills = [makeSkill("skill-1"), makeSkill("skill-2")];
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue(skills),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, artifactRepo, plannerAgent, eventRepo } = buildDeps(initialRun, store, {
      agentSkillRepo,
    });
    const svc = new OrchestratorService(deps as never);

    const newPlan = makePlan({ planVersion: 2 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? asArtifact("Plan", 2, newPlan) : null),
    );
    plannerAgent.run.mockResolvedValue(newPlan);

    await svc.rejectPlan("run-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Fix the thing"),
      expect.any(Number),
    );
    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ priorSkills: skills }),
    );

    const injectionEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvent).toBeDefined();
    expect((injectionEvent![0] as { payloadJson: { skillIds: string[] } }).payloadJson.skillIds).toEqual([
      "skill-1",
      "skill-2",
    ]);
  });

  it("retrieveSkillsForPlanning does not record an event when no skills are found", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store: TestStore = { runState: RunState.AwaitingPlanApproval };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, artifactRepo, plannerAgent, eventRepo } = buildDeps(initialRun, store, {
      agentSkillRepo,
    });
    const svc = new OrchestratorService(deps as never);

    const newPlan = makePlan({ planVersion: 2 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? asArtifact("Plan", 2, newPlan) : null),
    );
    plannerAgent.run.mockResolvedValue(newPlan);

    await svc.rejectPlan("run-1");

    const injectionEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvent).toBeUndefined();
  });

  it("updateSkillMetrics increments success and archives-if-low-utility for every uniquely injected skill on a Done transition", async () => {
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const store: TestStore = { runState: RunState.ReadyForHumanReview };
    const updatedSkill = { id: "skill-1", utilityScore: 0.8 };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockResolvedValue(updatedSkill),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, eventRepo } = buildDeps(initialRun, store, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    // Two SKILL_INJECTION events across two planning passes, overlapping IDs
    // (skill-1 injected twice) to exercise de-duplication.
    eventRepo.findByRunId.mockResolvedValue([
      asEvent("SKILL_INJECTION", { skillIds: ["skill-1", "skill-2"] }),
      asEvent("SKILL_INJECTION", { skillIds: ["skill-1"] }),
    ]);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
  });

  it("updateSkillMetrics increments failure counts on a Failed transition", async () => {
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const store: TestStore = { runState: RunState.HumanClarificationNeeded };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockResolvedValue({ id: "skill-1", utilityScore: 0.1 }),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, artifactRepo, plannerAgent, eventRepo } = buildDeps(initialRun, store, {
      agentSkillRepo,
    });
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const stillBlockingPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }],
    });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "TaskBundle") {
        return Promise.resolve(
          asArtifact("TaskBundle", 1, {
            issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
            repo: {
              name: "test-repo",
              defaultBranch: "main",
              workingBranch: "ai/lin-1",
              repoPath: "/tmp",
              allowedPaths: [],
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
          }),
        );
      }
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(stillBlockingPlan);

    eventRepo.findByRunId.mockResolvedValue([
      asEvent(RunEvent.NEEDS_HUMAN_CLARIFICATION),
      asEvent(RunEvent.NEEDS_HUMAN_CLARIFICATION),
      asEvent(RunEvent.NEEDS_HUMAN_CLARIFICATION),
      asEvent("SKILL_INJECTION", { skillIds: ["skill-1"] }),
    ]);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "x" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("updateSkillMetrics is a no-op (never calls increment*) when no SKILL_INJECTION events were recorded", async () => {
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const store: TestStore = { runState: RunState.ReadyForHumanReview };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, eventRepo } = buildDeps(initialRun, store, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    eventRepo.findByRunId.mockResolvedValue([]);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });

  it("updateSkillMetrics logs a warning and continues when incrementSuccess throws for one skill", async () => {
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const store: TestStore = { runState: RunState.ReadyForHumanReview };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi
        .fn()
        .mockRejectedValueOnce(new Error("db down"))
        .mockResolvedValueOnce({ id: "skill-2", utilityScore: 0.8 }),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, eventRepo, logger } = buildDeps(initialRun, store, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    eventRepo.findByRunId.mockResolvedValue([
      asEvent("SKILL_INJECTION", { skillIds: ["skill-1", "skill-2"] }),
    ]);

    const result = await svc.approveHumanReview("run-1");

    // The whole run still completes; the metric failure is best-effort.
    expect(result.state).toBe(RunState.Done);
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(1);
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith({
      id: "skill-2",
      utilityScore: 0.8,
    });

    const warnCall = logger.warn.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Failed to update skill metric"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { skillId: string; error: string }).skillId).toBe("skill-1");
    expect((warnCall![0] as { skillId: string; error: string }).error).toBe("db down");
  });
});

describe("OrchestratorService.rejectPlan -- fresh mode", () => {
  it("does not load prior plan/answers context (loadReplanContext is skipped) when mode is 'fresh'", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store: TestStore = { runState: RunState.AwaitingPlanApproval };
    const { deps, artifactRepo, plannerAgent, linearClient } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    // If loadReplanContext ran, it would read "Plan"/"HumanAnswers"/etc.
    // In fresh mode none of that should be injected into the planner call.
    // "RejectionContext" is read directly by rejectPlan regardless of mode
    // (for humanFeedback), so return null there too to keep this focused on
    // the previousPlan/humanAnswers/researchedAnswers/planReviewFindings gate.
    const newPlan = makePlan({ planVersion: 2 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "RejectionContext") return Promise.resolve(null);
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 2, newPlan));
      return Promise.resolve(asArtifact(type, 1, { bogus: true }));
    });
    plannerAgent.run.mockResolvedValue(newPlan);

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

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Plan rejected (fresh)"),
    );
    expect(comment).toBeDefined();
  });
});

describe("OrchestratorService.answerQuestions -- clarification loop-back when iterations remain", () => {
  it("transitions back to HumanClarificationNeeded (not Failed) with the updated blocking questions when below MAX_CLARIFICATION_ITERATIONS", async () => {
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const store: TestStore = { runState: RunState.HumanClarificationNeeded };
    const { deps, artifactRepo, plannerAgent, eventRepo } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const stillBlockingPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q2", question: "Still unclear?", requiredForExecution: true }],
    });

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "TaskBundle") {
        return Promise.resolve(
          asArtifact("TaskBundle", 1, {
            issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
            repo: {
              name: "test-repo",
              defaultBranch: "main",
              workingBranch: "ai/lin-1",
              repoPath: "/tmp",
              allowedPaths: [],
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
          }),
        );
      }
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(stillBlockingPlan);

    // Only 1 prior NEEDS_HUMAN_CLARIFICATION event -- below the max of 3.
    eventRepo.findByRunId.mockResolvedValue([asEvent(RunEvent.NEEDS_HUMAN_CLARIFICATION)]);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);

    const loopEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as { eventType: string }).eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION,
    );
    expect(loopEvent).toBeDefined();
    const payload = (loopEvent![0] as { payloadJson: { iteration: number; blockingQuestions: unknown[] } })
      .payloadJson;
    expect(payload.iteration).toBe(2);
    expect(payload.blockingQuestions).toEqual([{ id: "q2", question: "Still unclear?" }]);
  });
});
