import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, SkillDocument, HumanAnswer } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: "Some description text",
    linearIssueTitle: "Some title",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.AwaitingPlanApproval,
    planVersion: 2,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 3,
    summary: "Plan summary",
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
    issue: { id: "LIN-1", title: "Issue", description: "desc", labels: [], priority: 0 },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/run-1",
      repoPath: "/tmp/work",
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

interface StoredEvent {
  id: string;
  runId: string;
  eventType: string;
  source: string;
  payloadJson: unknown;
  createdAt: Date;
}

interface TestStore {
  run: Run;
  artifacts: Artifact[];
  events: StoredEvent[];
}

function asArtifact(overrides: {
  type: string;
  version: number;
  payloadJson: unknown;
  id?: string;
}): Artifact {
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

let eventCounter = 0;

function buildDeps(
  store: TestStore,
  opts: {
    agentSkillRepo?: {
      findTopKByRelevance?: ReturnType<typeof vi.fn>;
      incrementSuccess?: ReturnType<typeof vi.fn>;
      incrementFailure?: ReturnType<typeof vi.fn>;
      archiveIfLowUtility?: ReturnType<typeof vi.fn>;
    };
    plannerAgentRun?: ReturnType<typeof vi.fn>;
  } = {},
) {
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
    create: vi.fn().mockImplementation((params: {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    }) => {
      const a = asArtifact(params);
      store.artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      const latest = matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
      return Promise.resolve(latest);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: {
      runId: string;
      eventType: string;
      source: string;
      payloadJson?: unknown;
    }) => {
      const e: StoredEvent = {
        id: `event-${eventCounter++}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(e);
      return Promise.resolve(e);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Issue",
      description: "desc",
      branchName: "ai/run-1",
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
    postExecutionReportUpdate: vi.fn(),
  };

  const plannerAgent = { run: opts.plannerAgentRun ?? vi.fn().mockResolvedValue(makePlan()) };
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
    // Equal to run.workingDirectory so cleanupRunWorktree short-circuits.
    resolveMainRepoPath: vi.fn().mockImplementation((wd: string) => wd),
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

  const agentSkillRepo = opts.agentSkillRepo
    ? {
        findTopKByRelevance: opts.agentSkillRepo.findTopKByRelevance ?? vi.fn().mockResolvedValue([]),
        incrementSuccess: opts.agentSkillRepo.incrementSuccess ?? vi.fn().mockResolvedValue({}),
        incrementFailure: opts.agentSkillRepo.incrementFailure ?? vi.fn().mockResolvedValue({}),
        archiveIfLowUtility: opts.agentSkillRepo.archiveIfLowUtility ?? vi.fn().mockResolvedValue(undefined),
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
      ...(agentSkillRepo ? { agentSkillRepo } : {}),
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    logger,
    agentSkillRepo,
  };
}

describe("OrchestratorService -- retrieveSkillsForPlanning (via rejectPlan)", () => {
  function buildBlockedRejectScenario(opts: Parameters<typeof buildDeps>[1] = {}) {
    const store: TestStore = {
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }),
      artifacts: [],
      events: [],
    };
    const blockingPlan = makePlan({
      planVersion: 3,
      openQuestions: [{ id: "q1", question: "Blocking question?", requiredForExecution: true }],
    });
    const built = buildDeps(store, {
      ...opts,
      plannerAgentRun: vi.fn().mockResolvedValue(blockingPlan),
    });
    const svc = new OrchestratorService(built.deps as never);
    return { store, built, svc };
  }

  it("passes an empty priorSkills array and creates no SKILL_INJECTION event when agentSkillRepo is not configured", async () => {
    const { built, svc } = buildBlockedRejectScenario();

    await svc.rejectPlan("run-1");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ priorSkills: [] }),
    );
    const injectionEvents = built.eventRepo.create.mock.calls.filter(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvents).toHaveLength(0);
  });

  it("creates no SKILL_INJECTION event when the relevance search returns no skills", async () => {
    const findTopKByRelevance = vi.fn().mockResolvedValue([]);
    const { built, svc } = buildBlockedRejectScenario({
      agentSkillRepo: { findTopKByRelevance },
    });

    await svc.rejectPlan("run-1");

    expect(findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Some title"),
      3,
    );
    const injectionEvents = built.eventRepo.create.mock.calls.filter(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvents).toHaveLength(0);
  });

  it("records a SKILL_INJECTION event with the skill ids and feeds priorSkills to the planner when skills are found", async () => {
    const skills: SkillDocument[] = [
      {
        id: "skill-1",
        repoSlug: "test-repo",
        name: "Skill One",
        description: "desc",
        taskCategory: "backend",
        skillMarkdown: "# md",
        utilityScore: 0.5,
        lastUsedAt: new Date(),
      },
      {
        id: "skill-2",
        repoSlug: "test-repo",
        name: "Skill Two",
        description: "desc",
        taskCategory: "backend",
        skillMarkdown: "# md",
        utilityScore: 0.4,
        lastUsedAt: new Date(),
      },
    ];
    const findTopKByRelevance = vi.fn().mockResolvedValue(skills);
    const { built, svc } = buildBlockedRejectScenario({
      agentSkillRepo: { findTopKByRelevance },
    });

    await svc.rejectPlan("run-1");

    const injectionCall = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionCall).toBeDefined();
    expect((injectionCall![0] as { payloadJson: { skillIds: string[] } }).payloadJson.skillIds).toEqual([
      "skill-1",
      "skill-2",
    ]);
    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ priorSkills: skills }),
    );
  });
});

describe("OrchestratorService -- updateSkillMetrics (via approveHumanReview, success path)", () => {
  function buildReadyForReviewScenario(opts: Parameters<typeof buildDeps>[1] = {}) {
    const store: TestStore = {
      run: makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/work" }),
      artifacts: [],
      events: [],
    };
    const built = buildDeps(store, opts);
    const svc = new OrchestratorService(built.deps as never);
    return { store, built, svc };
  }

  it("completes successfully with no skill-metric calls when agentSkillRepo is not configured", async () => {
    const { store, svc } = buildReadyForReviewScenario();

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(store.run.state).toBe(RunState.Done);
  });

  it("does nothing when there are no SKILL_INJECTION events recorded for the run", async () => {
    const incrementSuccess = vi.fn();
    const { built, svc } = buildReadyForReviewScenario({
      agentSkillRepo: { incrementSuccess },
    });

    await svc.approveHumanReview("run-1");

    expect(incrementSuccess).not.toHaveBeenCalled();
    expect(built.agentSkillRepo?.incrementSuccess).not.toHaveBeenCalled();
  });

  it("calls incrementSuccess once per de-duplicated skill id across multiple injection events, then archives if low utility", async () => {
    const incrementSuccess = vi.fn().mockImplementation((id: string) =>
      Promise.resolve({ id, successCount: 1, failureCount: 0, utilityScore: 0.5 }),
    );
    const archiveIfLowUtility = vi.fn().mockResolvedValue(undefined);
    const { store, built, svc } = buildReadyForReviewScenario({
      agentSkillRepo: { incrementSuccess, archiveIfLowUtility },
    });

    store.events.push(
      {
        id: "evt-1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["s1", "s2"] },
        createdAt: new Date(),
      },
      {
        id: "evt-2",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["s2", "s3"] },
        createdAt: new Date(),
      },
    );

    await svc.approveHumanReview("run-1");

    expect(incrementSuccess).toHaveBeenCalledTimes(3);
    const calledIds = incrementSuccess.mock.calls.map((c: unknown[]) => c[0]).sort();
    expect(calledIds).toEqual(["s1", "s2", "s3"]);
    expect(archiveIfLowUtility).toHaveBeenCalledTimes(3);
    void built;
  });

  it("logs a warning and continues with remaining skills when incrementSuccess throws for one id", async () => {
    const incrementSuccess = vi.fn().mockImplementation((id: string) => {
      if (id === "bad-skill") return Promise.reject(new Error("db exploded"));
      return Promise.resolve({ id, successCount: 1, failureCount: 0, utilityScore: 0.9 });
    });
    const archiveIfLowUtility = vi.fn().mockResolvedValue(undefined);
    const { store, built, svc } = buildReadyForReviewScenario({
      agentSkillRepo: { incrementSuccess, archiveIfLowUtility },
    });

    store.events.push({
      id: "evt-1",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["bad-skill", "good-skill"] },
      createdAt: new Date(),
    });

    await svc.approveHumanReview("run-1");

    expect(incrementSuccess).toHaveBeenCalledWith("bad-skill");
    expect(incrementSuccess).toHaveBeenCalledWith("good-skill");
    // Only the successful id reaches archiveIfLowUtility.
    expect(archiveIfLowUtility).toHaveBeenCalledTimes(1);
    const warnCall = built.logger.warn.mock.calls.find(
      (c: unknown[]) => (c[0] as { skillId?: string }).skillId === "bad-skill",
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { error: string }).error).toBe("db exploded");
  });
});

describe("OrchestratorService -- updateSkillMetrics (via answerQuestions exhausting clarification, failure path)", () => {
  it("calls incrementFailure when clarification is exhausted and the run transitions to Failed", async () => {
    const store: TestStore = {
      run: makeRun({
        state: RunState.HumanClarificationNeeded,
        planVersion: 2,
        workingDirectory: "/tmp/work",
      }),
      artifacts: [],
      events: [],
    };

    const seedQuestion = { id: "q1", question: "Blocking question?", requiredForExecution: true };
    store.artifacts.push(
      asArtifact({
        type: "Plan",
        version: 2,
        payloadJson: makePlan({ planVersion: 2, openQuestions: [seedQuestion] }),
      }),
      asArtifact({ type: "TaskBundle", version: 1, payloadJson: makeTaskBundle() }),
    );
    // Pre-seed 3 prior clarification rounds so this one exhausts the retry budget.
    for (let i = 0; i < 3; i++) {
      store.events.push({
        id: `preseed-clarify-${i}`,
        runId: "run-1",
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      });
    }
    store.events.push({
      id: "preseed-skill-injection",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["s1"] },
      createdAt: new Date(),
    });

    const stillBlockedPlan = makePlan({ planVersion: 3, openQuestions: [seedQuestion] });
    const incrementFailure = vi.fn().mockResolvedValue({
      id: "s1",
      successCount: 0,
      failureCount: 1,
      utilityScore: 0,
    });
    const archiveIfLowUtility = vi.fn().mockResolvedValue(undefined);

    const built = buildDeps(store, {
      plannerAgentRun: vi.fn().mockResolvedValue(stillBlockedPlan),
      agentSkillRepo: { incrementFailure, archiveIfLowUtility },
    });
    const svc = new OrchestratorService(built.deps as never);

    const answers: HumanAnswer[] = [{ questionId: "q1", answer: "Answered, but still blocked" }];
    const result = await svc.answerQuestions("run-1", answers);

    expect(result.state).toBe(RunState.Failed);
    expect(incrementFailure).toHaveBeenCalledWith("s1");
    expect(archiveIfLowUtility).toHaveBeenCalledTimes(1);
  });
});
