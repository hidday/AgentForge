import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
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
    branchName: null,
    prNumber: null,
    state: RunState.AwaitingPlanApproval,
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

function makeArtifact(overrides: Partial<Artifact> & { type: Artifact["type"] }): Artifact {
  return {
    id: `artifact-${overrides.type}-${Math.random()}`,
    runId: "run-1",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<RunEventRecord> & { eventType: string }): RunEventRecord {
  return {
    id: `event-${Math.random()}`,
    runId: "run-1",
    source: "orchestrator",
    payloadJson: {},
    createdAt: new Date(),
    ...overrides,
  };
}

interface Store {
  run: Run;
  events?: RunEventRecord[];
}

function buildDeps(store: Store, overrides: Record<string, unknown> = {}) {
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
    findLatestByType: vi.fn().mockResolvedValue(null),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: { eventType: string; source: string; payloadJson?: unknown }) => {
      const e = makeEvent({ eventType: params.eventType, source: params.source, payloadJson: params.payloadJson ?? {} });
      store.events?.push(e);
      return Promise.resolve(e);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...(store.events ?? [])])),
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

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };

  const defaultRepoEntry = {
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
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(defaultRepoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(defaultRepoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(defaultRepoEntry),
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
    plannerAgent,
    githubClient,
    gitService,
    logger,
  };
}

describe("OrchestratorService.rejectPlan -- blocking questions remain", () => {
  it("pauses for human clarification instead of proceeding to plan review", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store: Store = { run, events: [] };
    const { deps, plannerAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const newPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(newPlan);

    const reviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.rejectPlan("run-1", "feedback");

    expect(reviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.rejectPlan -- iterate mode context propagation", () => {
  it("passes humanAnswers, researchedAnswers, and planReviewFindings from loadReplanContext to the planner", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const store: Store = { run, events: [] };
    const { deps, artifactRepo, plannerAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const previousPlan = makePlan({ planVersion: 2 });
    const humanAnswersPayload = { answers: [{ questionId: "q1", answer: "yes" }] };
    const researchedAnswersPayload = {
      summary: "s",
      answers: [{ questionId: "q1", question: "Q?", answer: "A", confidence: "high" as const }],
      completedAt: new Date().toISOString(),
    };
    const planReviewPayload = {
      summary: "review summary",
      findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
    };

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: previousPlan }));
      if (type === "HumanAnswers")
        return Promise.resolve(makeArtifact({ type: "HumanAnswers", payloadJson: humanAnswersPayload }));
      if (type === "ResearchedAnswers")
        return Promise.resolve(
          makeArtifact({ type: "ResearchedAnswers", payloadJson: researchedAnswersPayload }),
        );
      if (type === "PlanReview")
        return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: planReviewPayload }));
      return Promise.resolve(null);
    });

    const newPlan = makePlan({ planVersion: 3, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue({ ...store.run, state: RunState.PlanReview });

    await svc.rejectPlan("run-1", "more feedback", "api", "iterate");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        previousPlan,
        humanAnswers: humanAnswersPayload.answers,
        researchedAnswers: researchedAnswersPayload.answers,
        planReviewFindings: planReviewPayload,
      }),
    );
  });

  it("does not load prior context in fresh mode", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const store: Store = { run, events: [] };
    const { deps, artifactRepo, plannerAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const previousPlan = makePlan({ planVersion: 2 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: previousPlan }));
      return Promise.resolve(null);
    });

    const newPlan = makePlan({ planVersion: 3, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue({ ...store.run, state: RunState.PlanReview });

    await svc.rejectPlan("run-1", "more feedback", "api", "fresh");

    const callArgs = (plannerAgent.run as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[2]).not.toHaveProperty("previousPlan");
  });
});

describe("OrchestratorService.answerQuestions -- additional error and iteration paths", () => {
  it("throws when there is no Plan artifact for the run", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const store: Store = { run, events: [] };
    const { deps, artifactRepo } = buildDeps(store);
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No plan artifact found/);
  });

  it("throws when there is no TaskBundle artifact after clarification is recorded", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const store: Store = { run, events: [] };
    const { deps, artifactRepo } = buildDeps(store);
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "TaskBundle") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No TaskBundle artifact found/);
  });

  it("re-pauses for clarification (incrementing the iteration count) when blockers remain but max iterations not reached", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const store: Store = {
      run,
      events: [
        makeEvent({ eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
        makeEvent({ eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
      ],
    };
    const { deps, artifactRepo, plannerAgent } = buildDeps(store);
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const bundle = makeTaskBundle();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "TaskBundle") return Promise.resolve(makeArtifact({ type: "TaskBundle", payloadJson: bundle }));
      return Promise.resolve(null);
    });

    const newPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(newPlan);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "partial" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const call = (deps.eventRepo as { create: ReturnType<typeof vi.fn> }).create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION,
    );
    expect(call).toBeDefined();
    expect((call![0] as { payloadJson: { iteration: number } }).payloadJson.iteration).toBe(3);
  });
});

describe("OrchestratorService -- retrieveSkillsForPlanning", () => {
  it("returns an empty array and skips event creation when no agentSkillRepo is configured", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const store: Store = { run, events: [] };
    const { deps, eventRepo, plannerAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
    vi.spyOn(svc, "runPlanReview").mockResolvedValue({ ...store.run, state: RunState.PlanReview });

    await svc.rejectPlan("run-1");

    const skillEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(skillEvent).toBeUndefined();
  });

  it("records a SKILL_INJECTION event when skills are found", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const store: Store = { run, events: [] };
    const skills = [
      {
        id: "skill-1",
        repoSlug: "test-repo",
        name: "Skill One",
        description: "d",
        taskCategory: "backend",
        skillMarkdown: "md",
        utilityScore: 1,
        lastUsedAt: new Date(),
      },
    ];
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue(skills) };
    const { deps, eventRepo, plannerAgent } = buildDeps(store, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
    vi.spyOn(svc, "runPlanReview").mockResolvedValue({ ...store.run, state: RunState.PlanReview });

    await svc.rejectPlan("run-1");

    const skillEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(skillEvent).toBeDefined();
    expect((skillEvent![0] as { payloadJson: { skillIds: string[] } }).payloadJson.skillIds).toEqual([
      "skill-1",
    ]);
  });

  it("does not record a SKILL_INJECTION event when the repo returns no skills", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const store: Store = { run, events: [] };
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue([]) };
    const { deps, eventRepo, plannerAgent } = buildDeps(store, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
    vi.spyOn(svc, "runPlanReview").mockResolvedValue({ ...store.run, state: RunState.PlanReview });

    await svc.rejectPlan("run-1");

    const skillEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(skillEvent).toBeUndefined();
  });
});

describe("OrchestratorService -- updateSkillMetrics (via transitionAndRecord into Done/Failed)", () => {
  it("increments success and archives low-utility skills for every uniquely-injected skill id on a successful run", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp" });
    const store: Store = {
      run,
      events: [
        makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["s1", "s2"] } }),
        makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["s2", "s3"] } }),
      ],
    };
    const updatedSkill = { id: "updated" };
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockResolvedValue(updatedSkill),
      incrementFailure: vi.fn().mockResolvedValue(updatedSkill),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps } = buildDeps(store, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(3);
    const calledIds = agentSkillRepo.incrementSuccess.mock.calls.map((c: unknown[]) => c[0]).sort();
    expect(calledIds).toEqual(["s1", "s2", "s3"]);
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(3);
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });

  it("increments failure metrics when the run transitions to Failed", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const store: Store = {
      run,
      events: [
        makeEvent({ eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
        makeEvent({ eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
        makeEvent({ eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
        makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["s1"] } }),
      ],
    };
    const updatedSkill = { id: "updated" };
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockResolvedValue(updatedSkill),
      incrementFailure: vi.fn().mockResolvedValue(updatedSkill),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, artifactRepo, plannerAgent } = buildDeps(store, { agentSkillRepo });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const bundle = makeTaskBundle();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "TaskBundle") return Promise.resolve(makeArtifact({ type: "TaskBundle", payloadJson: bundle }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "partial" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("s1");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("logs a warning and continues when updating a skill metric throws", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp" });
    const store: Store = {
      run,
      events: [makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["s1", "s2"] } })],
    };
    const agentSkillRepo = {
      incrementSuccess: vi
        .fn()
        .mockRejectedValueOnce(new Error("db down"))
        .mockResolvedValueOnce({ id: "s2" }),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, logger } = buildDeps(store, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Failed to update skill metric"),
    );
    expect(warnCall).toBeDefined();
  });

  it("does nothing when no agentSkillRepo is configured", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp" });
    const store: Store = { run, events: [makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["s1"] } })] };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });

  it("does nothing when there are no SKILL_INJECTION events on the run", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp" });
    const store: Store = { run, events: [] };
    const agentSkillRepo = {
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps } = buildDeps(store, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.buildTaskBundle -- default branch resolution", () => {
  it("prefers the remote default branch over the configured one, and logs a warning, when they differ", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store: Store = { run, events: [] };
    const { deps, githubClient, plannerAgent, logger } = buildDeps(store);
    githubClient.getDefaultBranch.mockResolvedValue("develop");
    const svc = new OrchestratorService(deps as never);

    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue({ ...store.run, state: RunState.PlanReview });

    await svc.rejectPlan("run-1");

    const callArgs = (plannerAgent.run as ReturnType<typeof vi.fn>).mock.calls[0];
    const bundle = callArgs[0] as TaskBundle;
    expect(bundle.repo.defaultBranch).toBe("develop");

    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Config defaultBranch differs"),
    );
    expect(warnCall).toBeDefined();
  });

  it("keeps the configured default branch when the remote branch matches", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store: Store = { run, events: [] };
    const { deps, githubClient, plannerAgent } = buildDeps(store);
    githubClient.getDefaultBranch.mockResolvedValue("main");
    const svc = new OrchestratorService(deps as never);

    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue({ ...store.run, state: RunState.PlanReview });

    await svc.rejectPlan("run-1");

    const callArgs = (plannerAgent.run as ReturnType<typeof vi.fn>).mock.calls[0];
    const bundle = callArgs[0] as TaskBundle;
    expect(bundle.repo.defaultBranch).toBe("main");
  });

  it("forwards relatedContext onto the TaskBundle when the parent issue is present", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store: Store = { run, events: [] };
    const { deps, plannerAgent } = buildDeps(store, {
      linearClient: {
        getIssue: vi.fn().mockResolvedValue({
          id: "LIN-1",
          title: "Test issue",
          description: "Test description",
          branchName: "ai/lin-1",
          labels: [],
          priority: 0,
        }),
        postComment: vi.fn().mockResolvedValue(undefined),
        getRelatedContext: vi.fn().mockResolvedValue({
          parent: {
            id: "p1",
            identifier: "PRY-1",
            title: "Parent",
            description: "d",
            state: "Todo",
            labels: [],
            priority: 0,
            url: "https://linear.app/x",
          },
          blockers: [],
        }),
      },
    });
    const svc = new OrchestratorService(deps as never);

    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue({ ...store.run, state: RunState.PlanReview });

    await svc.rejectPlan("run-1");

    const callArgs = (plannerAgent.run as ReturnType<typeof vi.fn>).mock.calls[0];
    const bundle = callArgs[0] as TaskBundle;
    expect(bundle.relatedContext?.parent?.identifier).toBe("PRY-1");
  });
});
