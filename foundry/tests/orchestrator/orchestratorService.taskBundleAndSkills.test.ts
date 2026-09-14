import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
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
    branchName: "ai/run-1",
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

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version}`,
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
  artifacts: Artifact[];
  runPatch: Partial<Run>;
  events: RunEventRecord[];
}

function buildDeps(store: TestStore, initialRun: Run, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ ...initialRun, ...store.runPatch, state: store.runState }),
      ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, ...store.runPatch, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      store.runPatch = { ...store.runPatch, ...patch };
      return Promise.resolve({ ...initialRun, ...store.runPatch, state: store.runState });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
    }) => {
      const a = asArtifact({ type: params.type, version: params.version, payloadJson: params.payloadJson });
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

  let eventIdCounter = 0;
  const eventRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const rec: RunEventRecord = {
        id: `event-${++eventIdCounter}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(rec);
      return Promise.resolve(rec);
    }),
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
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(null),
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
      overallVerdict: "approved",
      summary: "OK",
      findings: [],
    }),
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
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
  };

  const agentSkillRepo = {
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn(),
    incrementFailure: vi.fn(),
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
      logger,
      dashboardEmitter,
      agentSkillRepo,
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    plannerAgent,
    logger,
    agentSkillRepo,
  };
}

describe("OrchestratorService.buildTaskBundle -- default branch resolution", () => {
  it("uses GitHub's remote default branch and logs a warning when it differs from the configured value", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      runPatch: {},
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, githubClient, plannerAgent, logger } = buildDeps(store, initialRun);

    (githubClient.getDefaultBranch as ReturnType<typeof vi.fn>).mockResolvedValue("trunk");
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2 }));

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1", undefined, "api", "fresh");

    const plannerCall = (plannerAgent.run as ReturnType<typeof vi.fn>).mock.calls[0];
    const bundle = plannerCall[0] as TaskBundle;
    expect(bundle.repo.defaultBranch).toBe("trunk");

    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Config defaultBranch differs"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { config: string; remote: string }).config).toBe("main");
    expect((warnCall![0] as { config: string; remote: string }).remote).toBe("trunk");
  });
});

describe("OrchestratorService.rejectPlan -- mode handling", () => {
  it("mode='fresh' skips loadReplanContext entirely (no previousPlan/humanAnswers/researchedAnswers injected)", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
        }),
      ],
      runPatch: {},
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const { deps, plannerAgent } = buildDeps(store, initialRun);
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2 }));

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1", "Start over please", "api", "fresh");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({
        previousPlan: expect.anything(),
        humanAnswers: expect.anything(),
      }),
    );
  });

  it("mode='iterate' (default) injects previousPlan, humanAnswers, researchedAnswers and planReviewFindings from prior artifacts", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
        }),
        asArtifact({
          type: "ResearchedAnswers",
          version: 1,
          payloadJson: {
            summary: "s",
            answers: [{ questionId: "q2", question: "Q2", answer: "A2", confidence: "medium" }],
            completedAt: "2026-01-01T00:00:00Z",
          },
        }),
        asArtifact({
          type: "PlanReview",
          version: 1,
          payloadJson: { summary: "review", findings: [] },
        }),
      ],
      runPatch: {},
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const { deps, plannerAgent } = buildDeps(store, initialRun);
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2 }));

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1", "Please iterate", "api", "iterate");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        previousPlan: plan,
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q2", question: "Q2", answer: "A2", confidence: "medium" }],
        planReviewFindings: { summary: "review", findings: [] },
      }),
    );
  });
});

describe("OrchestratorService.retrieveSkillsForPlanning / updateSkillMetrics", () => {
  it("returns [] and does not touch eventRepo when agentSkillRepo is not configured", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      runPatch: {},
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, plannerAgent, eventRepo } = buildDeps(store, initialRun, { agentSkillRepo: undefined });
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2 }));

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1");

    const skillEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(skillEvent).toBeUndefined();
  });

  it("injects skills and records a SKILL_INJECTION event when agentSkillRepo finds relevant skills", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      runPatch: {},
      events: [],
    };
    const initialRun = makeRun({
      state: RunState.AwaitingPlanApproval,
      linearIssueTitle: "Fix the bug",
    });
    const { deps, plannerAgent, eventRepo, agentSkillRepo } = buildDeps(store, initialRun);
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2 }));
    agentSkillRepo.findTopKByRelevance.mockResolvedValue([
      {
        id: "skill-1",
        repoSlug: "test-repo",
        name: "Bug fixing",
        description: "How to fix bugs",
        taskCategory: "bugfix",
        skillMarkdown: "# fix bugs",
        utilityScore: 0.5,
        lastUsedAt: new Date(),
      },
    ]);

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Fix the bug"),
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

  it("updateSkillMetrics increments success and archives-check for every distinct injected skill when a run completes Done", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [], runPatch: {}, events: [] };
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp" });
    const { deps, agentSkillRepo } = buildDeps(store, initialRun);

    // Two SKILL_INJECTION events (e.g. initial plan + a re-plan), overlapping skill IDs
    // should be deduplicated.
    store.events.push(
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
    );

    agentSkillRepo.incrementSuccess.mockImplementation((id: string) =>
      Promise.resolve({ id, successCount: 1, failureCount: 0, utilityScore: 0.5 }),
    );

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
  });

  it("updateSkillMetrics increments failure for injected skills when a run transitions to Failed", async () => {
    const store: TestStore = {
      runState: RunState.HumanClarificationNeeded,
      artifacts: [],
      runPatch: { planVersion: 1 },
      events: [
        {
          id: "e0",
          runId: "run-1",
          eventType: "NEEDS_HUMAN_CLARIFICATION",
          source: "planner-agent",
          payloadJson: {},
          createdAt: new Date(),
        },
        {
          id: "e1",
          runId: "run-1",
          eventType: "NEEDS_HUMAN_CLARIFICATION",
          source: "planner-agent",
          payloadJson: {},
          createdAt: new Date(),
        },
        {
          id: "e2",
          runId: "run-1",
          eventType: "NEEDS_HUMAN_CLARIFICATION",
          source: "planner-agent",
          payloadJson: {},
          createdAt: new Date(),
        },
        {
          id: "e3",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-9"] },
          createdAt: new Date(),
        },
      ],
    };
    const plan = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Still blocked?", requiredForExecution: true }],
    });
    store.artifacts.push(
      asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
      asArtifact({
        type: "TaskBundle",
        version: 1,
        payloadJson: {
          issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
          repo: {
            name: "test-repo",
            defaultBranch: "main",
            workingBranch: "ai/run-1",
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
        },
      }),
    );

    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded, workingDirectory: "/tmp" });
    const { deps, plannerAgent, agentSkillRepo } = buildDeps(store, initialRun);
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still blocked?", requiredForExecution: true }],
      }),
    );
    agentSkillRepo.incrementFailure.mockImplementation((id: string) =>
      Promise.resolve({ id, successCount: 0, failureCount: 1, utilityScore: 0.1 }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still stuck" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-9");
  });

  it("updateSkillMetrics swallows a per-skill error and continues (best-effort)", async () => {
    const store: TestStore = {
      runState: RunState.ReadyForHumanReview,
      artifacts: [],
      runPatch: {},
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-err", "skill-ok"] },
          createdAt: new Date(),
        },
      ],
    };
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp" });
    const { deps, logger, agentSkillRepo } = buildDeps(store, initialRun);

    agentSkillRepo.incrementSuccess.mockImplementation((id: string) => {
      if (id === "skill-err") return Promise.reject(new Error("db down"));
      return Promise.resolve({ id, successCount: 1, failureCount: 0, utilityScore: 0.5 });
    });

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    // The failing skill's error was logged, not thrown -- the other skill still updated.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-err", error: "db down" }),
      "Failed to update skill metric",
    );
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(1);
  });
});

describe("OrchestratorService -- requireRun not-found path", () => {
  it("rejectPlan throws 'Run not found' when the run id does not exist", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], runPatch: {}, events: [] };
    const initialRun = makeRun();
    const { deps, runRepo } = buildDeps(store, initialRun);
    runRepo.findById.mockResolvedValue(null);

    const svc = new OrchestratorService(deps as never);
    await expect(svc.rejectPlan("no-such-run")).rejects.toThrow("Run not found: no-such-run");
  });
});

describe("OrchestratorService.cleanupRunWorktree", () => {
  it("does not call gitService.removeWorktree when the worktree path already equals the main repo path", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [], runPatch: {}, events: [] };
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/main-repo" });
    const { deps } = buildDeps(store, initialRun);
    (deps.gitService.resolveMainRepoPath as ReturnType<typeof vi.fn>).mockReturnValue("/tmp/main-repo");

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(deps.gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("calls gitService.removeWorktree when the worktree path differs from the main repo path", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [], runPatch: {}, events: [] };
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree-run-1" });
    const { deps } = buildDeps(store, initialRun);
    (deps.gitService.resolveMainRepoPath as ReturnType<typeof vi.fn>).mockReturnValue("/tmp/main-repo");

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(deps.gitService.removeWorktree).toHaveBeenCalledWith("/tmp/main-repo", "/tmp/worktree-run-1");
  });
});
