import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
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

interface TestStore {
  runState: RunState;
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildDeps(store: TestStore, agentSkillRepo?: Record<string, unknown>) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...store.run, state: store.runState }),
    ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      store.run = { ...store.run, state: newState };
      return Promise.resolve(store.run);
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      store.run = { ...store.run, ...patch };
      return Promise.resolve(store.run);
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation(
      (params: { runId: string; type: string; version: number; payloadJson: unknown; rawText: string }) => {
        const a = asArtifact({
          type: params.type,
          version: params.version,
          payloadJson: params.payloadJson,
        });
        store.artifacts.push(a);
        return Promise.resolve(a);
      },
    ),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      const latest = matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
      return Promise.resolve(latest);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation(
      (params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
        const e: RunEventRecord = {
          id: `event-${store.events.length}`,
          runId: params.runId,
          eventType: params.eventType,
          source: params.source,
          payloadJson: params.payloadJson ?? {},
          createdAt: new Date(),
        };
        store.events.push(e);
        return Promise.resolve(e);
      },
    ),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

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
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    }),
    getDefaultRepo: vi.fn().mockReturnValue({
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
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({
      reviewId: "pr-1",
      summary: "Looks good",
      overallVerdict: "approved",
      findings: [],
    }),
  };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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
      ...(agentSkillRepo ? { agentSkillRepo } : {}),
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    gitService,
    plannerAgent,
    planReviewerAgent,
    logger,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("no blocking questions: re-plans, records PLAN_CREATED, and proceeds to plan review", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.Planning,
      run: makeRun({ state: RunState.Planning, planVersion: 1 }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const built = buildDeps(store);
    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    built.plannerAgent.run.mockImplementation(async () => {
      store.artifacts.push(asArtifact({ type: "Plan", version: newPlan.planVersion, payloadJson: newPlan }));
      return newPlan;
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanning("run-1");

    expect(store.events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining([RunEvent.PLAN_CREATED, RunEvent.PLAN_REVIEW_APPROVED]),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(store.run.planVersion).toBe(2);
  });

  it("with blocking questions: pauses for human clarification instead of reviewing", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.Planning,
      run: makeRun({ state: RunState.Planning, planVersion: 1 }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const built = buildDeps(store);
    built.plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("passes prior rejection feedback, previous plan, and plan review findings context to the planner", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.Planning,
      run: makeRun({ state: RunState.Planning, planVersion: 1 }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({
          type: "RejectionContext",
          version: 1,
          payloadJson: { planVersion: 1, feedback: "Use Postgres", source: "api", mode: "iterate" },
        }),
        asArtifact({
          type: "PlanReview",
          version: 1,
          payloadJson: { summary: "review summary", findings: [] },
        }),
        asArtifact({
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
        }),
      ],
      events: [],
    };
    const built = buildDeps(store);
    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    built.plannerAgent.run.mockImplementation(async () => {
      store.artifacts.push(asArtifact({ type: "Plan", version: newPlan.planVersion, payloadJson: newPlan }));
      return newPlan;
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanning("run-1");

    const call = built.plannerAgent.run.mock.calls[0][2];
    expect(call.previousPlan).toEqual(plan);
    expect(call.humanFeedback).toEqual({ planVersion: 1, feedback: "Use Postgres" });
    expect(call.humanAnswers).toEqual([{ questionId: "q1", answer: "yes" }]);
    expect(call.planReviewFindings).toEqual({ summary: "review summary", findings: [] });
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName", async () => {
    const store: TestStore = {
      runState: RunState.Todo,
      run: makeRun({ state: RunState.Todo, branchName: null }),
      artifacts: [],
      events: [],
    };
    const built = buildDeps(store);
    const newPlan = makePlan({ planVersion: 1, openQuestions: [] });
    built.plannerAgent.run.mockImplementation(async () => {
      store.artifacts.push(asArtifact({ type: "Plan", version: newPlan.planVersion, payloadJson: newPlan }));
      return newPlan;
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.retryRun("run-1");

    expect(built.gitService.setupRunWorktree).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const store: TestStore = {
      runState: RunState.Todo,
      run: makeRun({ state: RunState.Todo, branchName: "ai/run-1", workingDirectory: "/tmp/worktree" }),
      artifacts: [],
      events: [],
    };
    const built = buildDeps(store);
    const newPlan = makePlan({ planVersion: 1, openQuestions: [] });
    built.plannerAgent.run.mockImplementation(async () => {
      store.artifacts.push(asArtifact({ type: "Plan", version: newPlan.planVersion, payloadJson: newPlan }));
      return newPlan;
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.retryRun("run-1");

    expect(built.gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("with blocking questions: pauses for human clarification", async () => {
    const store: TestStore = {
      runState: RunState.Todo,
      run: makeRun({ state: RunState.Todo, branchName: "ai/run-1" }),
      artifacts: [],
      events: [],
    };
    const built = buildDeps(store);
    built.plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService retrieveSkillsForPlanning", () => {
  it("injects prior skills into the planner call and records a SKILL_INJECTION event when skills are found", async () => {
    const store: TestStore = {
      runState: RunState.Todo,
      run: makeRun({ state: RunState.Todo, branchName: "ai/run-1" }),
      artifacts: [],
      events: [],
    };
    const skillDoc = {
      id: "skill-1",
      repoSlug: "test-repo",
      name: "Retry pattern",
      description: "How to retry",
      taskCategory: "backend",
      skillMarkdown: "# retry",
      utilityScore: 0.8,
      lastUsedAt: new Date(),
    };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([skillDoc]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const built = buildDeps(store, agentSkillRepo);
    const newPlan = makePlan({ planVersion: 1, openQuestions: [] });
    built.plannerAgent.run.mockImplementation(async () => {
      store.artifacts.push(asArtifact({ type: "Plan", version: newPlan.planVersion, payloadJson: newPlan }));
      return newPlan;
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.retryRun("run-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Fix the thing"),
      expect.any(Number),
    );

    const call = built.plannerAgent.run.mock.calls[0][2];
    expect(call.priorSkills).toEqual([skillDoc]);

    const injectionEvent = store.events.find((e) => e.eventType === "SKILL_INJECTION");
    expect(injectionEvent).toBeDefined();
    expect((injectionEvent!.payloadJson as { skillIds: string[] }).skillIds).toEqual(["skill-1"]);
  });

  it("does not record a SKILL_INJECTION event when no skills are found", async () => {
    const store: TestStore = {
      runState: RunState.Todo,
      run: makeRun({ state: RunState.Todo, branchName: "ai/run-1" }),
      artifacts: [],
      events: [],
    };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const built = buildDeps(store, agentSkillRepo);
    const newPlan = makePlan({ planVersion: 1, openQuestions: [] });
    built.plannerAgent.run.mockImplementation(async () => {
      store.artifacts.push(asArtifact({ type: "Plan", version: newPlan.planVersion, payloadJson: newPlan }));
      return newPlan;
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.retryRun("run-1");

    const injectionEvent = store.events.find((e) => e.eventType === "SKILL_INJECTION");
    expect(injectionEvent).toBeUndefined();
  });

  it("returns an empty prior-skills list when no agentSkillRepo is configured", async () => {
    const store: TestStore = {
      runState: RunState.Todo,
      run: makeRun({ state: RunState.Todo, branchName: "ai/run-1" }),
      artifacts: [],
      events: [],
    };
    const built = buildDeps(store);
    const newPlan = makePlan({ planVersion: 1, openQuestions: [] });
    built.plannerAgent.run.mockImplementation(async () => {
      store.artifacts.push(asArtifact({ type: "Plan", version: newPlan.planVersion, payloadJson: newPlan }));
      return newPlan;
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.retryRun("run-1");

    const call = built.plannerAgent.run.mock.calls[0][2];
    expect(call.priorSkills).toEqual([]);
  });
});
