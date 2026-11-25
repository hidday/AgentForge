import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: "Fix the auth bug",
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
  } as Run;
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

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown; id?: string }): Artifact {
  return {
    id: overrides.id ?? `artifact-${overrides.type}-${overrides.version}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: new Date(),
  };
}

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: `event-${Math.random()}`,
    runId: "run-1",
    eventType: "SKILL_INJECTION",
    source: "orchestrator",
    payloadJson: {},
    createdAt: new Date(),
    ...overrides,
  };
}

interface TestStore {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildDeps(store: TestStore, agentSkillRepoOverrides?: Record<string, unknown>) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(store.run)),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn(),
    create: vi.fn().mockImplementation(() => Promise.resolve(store.run)),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, state: RunState) => {
      store.run = { ...store.run, state };
      return Promise.resolve(store.run);
    }),
    update: vi.fn().mockImplementation((_id: string, data: Partial<Run>) => {
      store.run = { ...store.run, ...data };
      return Promise.resolve(store.run);
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: { type: string; version: number; payloadJson: unknown }) => {
      const a = asArtifact(params);
      store.artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      return Promise.resolve(matching.reduce((best, cur) => (cur.version > best.version ? cur : best)));
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: { eventType: string; payloadJson?: unknown }) => {
      const e = makeEvent({ eventType: params.eventType, payloadJson: params.payloadJson ?? {} });
      store.events.push(e);
      return Promise.resolve(e);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Fix the auth bug",
      description: "auth is broken",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };
  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main") };
  const repoEntry = {
    name: "test-repo",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [],
    constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
  };
  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(repoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(repoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(repoEntry),
  };
  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };
  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn().mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] }) };
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

  const agentSkillRepo = agentSkillRepoOverrides
    ? {
        findTopKByRelevance: vi.fn().mockResolvedValue([]),
        incrementSuccess: vi.fn(),
        incrementFailure: vi.fn(),
        archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
        ...agentSkillRepoOverrides,
      }
    : undefined;

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
      agentSkillRepo,
    },
    runRepo,
    eventRepo,
    plannerAgent,
    logger,
    agentSkillRepo,
    store,
    // Mirrors what the real PlannerAgent does: resolves with the given plan AND
    // persists it as the run's latest "Plan" artifact, which downstream code
    // (runPlanReview, answerQuestions) reads back via findLatestByType.
    setPlannerPlan(plan: Plan) {
      plannerAgent.run.mockImplementation(() => {
        store.artifacts.push(asArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan }));
        return Promise.resolve(plan);
      });
    },
  };
}

describe("OrchestratorService.retrieveSkillsForPlanning (exercised via startRun)", () => {
  it("returns [] and skips event creation when no agentSkillRepo is injected", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const { deps, eventRepo, setPlannerPlan } = buildDeps(store, undefined);
    setPlannerPlan(makePlan());
    const svc = new OrchestratorService(deps as never);

    await svc.startRun("LIN-1");

    const skillEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(skillEvent).toBeUndefined();
  });

  it("queries skills by repo and a title+description-derived query, and records a SKILL_INJECTION event when results are found", async () => {
    const skillDoc = {
      id: "skill-1",
      repoSlug: "test-repo",
      name: "Auth pattern",
      description: "desc",
      taskCategory: "auth",
      skillMarkdown: "# Auth",
      utilityScore: 0.5,
      lastUsedAt: new Date(),
    };
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const { deps, eventRepo, setPlannerPlan, agentSkillRepo } = buildDeps(store, {
      findTopKByRelevance: vi.fn().mockResolvedValue([skillDoc]),
    });
    setPlannerPlan(makePlan());
    const svc = new OrchestratorService(deps as never);

    await svc.startRun("LIN-1");

    expect(agentSkillRepo!.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Fix the auth bug"),
      expect.any(Number),
    );
    const skillEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(skillEvent).toBeDefined();
    expect((skillEvent![0] as { payloadJson: { skillIds: string[] } }).payloadJson.skillIds).toEqual([
      "skill-1",
    ]);
  });

  it("does not record a SKILL_INJECTION event when no skills are found", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const { deps, eventRepo, setPlannerPlan } = buildDeps(store, {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
    });
    setPlannerPlan(makePlan());
    const svc = new OrchestratorService(deps as never);

    await svc.startRun("LIN-1");

    const skillEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(skillEvent).toBeUndefined();
  });
});

describe("OrchestratorService.updateSkillMetrics (exercised via a Done/Failed transition)", () => {
  it("does nothing when no agentSkillRepo is injected", async () => {
    const store: TestStore = { run: makeRun({ state: RunState.ReadyForHumanReview }), artifacts: [], events: [] };
    const { deps } = buildDeps(store, undefined);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });

  it("does nothing when there are no SKILL_INJECTION events for the run", async () => {
    const store: TestStore = { run: makeRun({ state: RunState.ReadyForHumanReview }), artifacts: [], events: [] };
    const { deps, agentSkillRepo } = buildDeps(store, {});
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo!.incrementSuccess).not.toHaveBeenCalled();
  });

  it("increments success and archive-checks each distinct injected skill on a Done transition", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.ReadyForHumanReview }),
      artifacts: [],
      events: [
        makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1", "skill-2"] } }),
        // A second injection event (re-plan) reinjecting skill-1 should be deduped.
        makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } }),
      ],
    };
    const { deps, agentSkillRepo } = buildDeps(store, {
      incrementSuccess: vi.fn().mockImplementation((id: string) =>
        Promise.resolve({ id, successCount: 1, failureCount: 0, utilityScore: 0.5 }),
      ),
    });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo!.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo!.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo!.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo!.incrementFailure).not.toHaveBeenCalled();
    expect(agentSkillRepo!.archiveIfLowUtility).toHaveBeenCalledTimes(2);
  });

  it("increments failure (not success) when the run ends in Failed", async () => {
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }],
    });
    const newPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }],
    });
    const taskBundle = {
      issue: { id: "LIN-1", title: "Fix the auth bug", description: "auth is broken", labels: [], priority: 0 },
      repo: { name: "test-repo", defaultBranch: "main", workingBranch: "ai/lin-1", repoPath: "/tmp", allowedPaths: ["src/"], protectedPaths: [] },
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
      definitionOfDone: [],
    };
    const store: TestStore = {
      run: makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({ type: "TaskBundle", version: 1, payloadJson: taskBundle }),
      ],
      events: [
        makeEvent({ eventType: "NEEDS_HUMAN_CLARIFICATION" }),
        makeEvent({ eventType: "NEEDS_HUMAN_CLARIFICATION" }),
        makeEvent({ eventType: "NEEDS_HUMAN_CLARIFICATION" }),
        makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } }),
      ],
    };
    const { deps, setPlannerPlan, agentSkillRepo } = buildDeps(store, {
      incrementFailure: vi.fn().mockResolvedValue({ id: "skill-1", successCount: 0, failureCount: 1, utilityScore: 0 }),
    });
    setPlannerPlan(newPlan);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unclear" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo!.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo!.incrementSuccess).not.toHaveBeenCalled();
  });

  it("logs a warning and continues with the remaining skills when updating one skill's metrics throws", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.ReadyForHumanReview }),
      artifacts: [],
      events: [makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1", "skill-2"] } })],
    };
    const { deps, agentSkillRepo, logger } = buildDeps(store, {
      incrementSuccess: vi
        .fn()
        .mockRejectedValueOnce(new Error("db exploded"))
        .mockResolvedValueOnce({ id: "skill-2", successCount: 1, failureCount: 0, utilityScore: 0.5 }),
    });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1", error: "db exploded" }),
      "Failed to update skill metric",
    );
    // skill-2 should still be processed despite skill-1 failing.
    expect(agentSkillRepo!.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo!.archiveIfLowUtility).toHaveBeenCalledTimes(1);
  });
});
