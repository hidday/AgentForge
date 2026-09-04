import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { env } from "../../src/config/env.js";
import type { Run, Artifact, RunEventRecord, SkillDocument } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: "Some description text",
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 0,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/worktree",
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Test plan",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: ["Note one"],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Clean implementation.",
    ...overrides,
  };
}

function makeSkill(overrides: Partial<SkillDocument> = {}): SkillDocument {
  return {
    id: "skill-1",
    repoSlug: "test-repo",
    name: "Some skill",
    description: "A helpful skill",
    taskCategory: "bugfix",
    skillMarkdown: "# Skill",
    utilityScore: 0.5,
    lastUsedAt: new Date(),
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
  events: RunEventRecord[];
}

function buildDeps(
  store: TestStore,
  initialRun: Run,
  extraDeps: Record<string, unknown> = {},
) {
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
    update: vi.fn().mockImplementation((_id: string, fields: Partial<Run>) =>
      Promise.resolve({ ...initialRun, ...fields, state: store.runState }),
    ),
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
      const latest = matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
      return Promise.resolve(latest);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: { eventType: string; payloadJson?: unknown }) => {
      const evt: RunEventRecord = {
        id: `event-${store.events.length + 1}`,
        runId: "run-1",
        eventType: params.eventType,
        source: "test",
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(evt);
      return Promise.resolve(evt);
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
  };

  const githubClient = { getPRDiff: vi.fn().mockResolvedValue("diff content") };

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
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
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
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/main-repo"),
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
      ...extraDeps,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    plannerAgent,
    executorAgent,
    githubClient,
    linearClient,
    gitService,
    logger,
  };
}

describe("OrchestratorService skill retrieval during planning (retrieveSkillsForPlanning)", () => {
  it("passes an empty priorSkills list to the planner when no agentSkillRepo is configured", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
    const initialRun = makeRun({ state: RunState.Todo, branchName: "ai/run-1" });
    const { deps, plannerAgent } = buildDeps(store, initialRun);
    (deps as unknown as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }).planReviewerAgent.run.mockResolvedValue(
      { overallVerdict: "approved", summary: "OK", findings: [] },
    );
    const svc = new OrchestratorService(deps as never);

    plannerAgent.run.mockImplementation(async () => {
      const plan = makePlan({ planVersion: 1 });
      store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: plan }));
      return plan;
    });

    await svc.retryRun("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ priorSkills: [] }),
    );
  });

  it("injects retrieved skills into the planner call and records a SKILL_INJECTION event", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
    const initialRun = makeRun({ state: RunState.Todo, branchName: "ai/run-1" });
    const skills = [makeSkill({ id: "skill-a" }), makeSkill({ id: "skill-b" })];
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue(skills),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, plannerAgent, eventRepo } = buildDeps(store, initialRun, { agentSkillRepo });
    (deps as unknown as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }).planReviewerAgent.run.mockResolvedValue(
      { overallVerdict: "approved", summary: "OK", findings: [] },
    );
    const svc = new OrchestratorService(deps as never);

    plannerAgent.run.mockImplementation(async () => {
      const plan = makePlan({ planVersion: 1 });
      store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: plan }));
      return plan;
    });

    await svc.retryRun("run-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Fix the bug"),
      env.MAX_SKILLS_INJECTED,
    );
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "SKILL_INJECTION",
        payloadJson: { skillIds: ["skill-a", "skill-b"] },
      }),
    );
    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ priorSkills: skills }),
    );
  });

  it("does not record a SKILL_INJECTION event when no relevant skills are found", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
    const initialRun = makeRun({ state: RunState.Todo, branchName: "ai/run-1" });
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, plannerAgent, eventRepo } = buildDeps(store, initialRun, { agentSkillRepo });
    (deps as unknown as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }).planReviewerAgent.run.mockResolvedValue(
      { overallVerdict: "approved", summary: "OK", findings: [] },
    );
    const svc = new OrchestratorService(deps as never);

    plannerAgent.run.mockImplementation(async () => {
      const plan = makePlan({ planVersion: 1 });
      store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: plan }));
      return plan;
    });

    await svc.retryRun("run-1");

    const injectionEvents = eventRepo.create.mock.calls.filter(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvents).toHaveLength(0);
  });
});

describe("OrchestratorService skill metrics on terminal transitions (updateSkillMetrics)", () => {
  it("increments success and archives-if-low-utility for each distinct skill injected across the run's history when it completes successfully", async () => {
    const store: TestStore = {
      runState: RunState.ReadyForHumanReview,
      artifacts: [],
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-a", "skill-b"] },
          createdAt: new Date(),
        },
        {
          id: "e2",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          // skill-a repeated across a re-plan; must be de-duplicated.
          payloadJson: { skillIds: ["skill-a"] },
          createdAt: new Date(),
        },
      ],
    };
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const updatedSkillA = makeSkill({ id: "skill-a", utilityScore: 0.7 });
    const updatedSkillB = makeSkill({ id: "skill-b", utilityScore: 0.8 });
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(id === "skill-a" ? updatedSkillA : updatedSkillB),
      ),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps } = buildDeps(store, initialRun, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-a");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-b");
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(updatedSkillA);
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(updatedSkillB);
  });

  it("increments failure for injected skills when the run transitions to Failed", async () => {
    const store: TestStore = {
      runState: RunState.HumanClarificationNeeded,
      artifacts: [
        asArtifact({
          type: "Plan",
          version: 1,
          payloadJson: makePlan({
            planVersion: 1,
            openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
          }),
        }),
        asArtifact({
          type: "TaskBundle",
          version: 1,
          payloadJson: {
            issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
            repo: {
              name: "test-repo",
              defaultBranch: "main",
              workingBranch: "ai/run-1",
              repoPath: "/tmp/worktree",
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
          },
        }),
      ],
      events: [
        { id: "e1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
        { id: "e2", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
        { id: "e3", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
        { id: "e4", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["skill-c"] }, createdAt: new Date() },
      ],
    };
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded });
    const updatedSkillC = makeSkill({ id: "skill-c", utilityScore: 0.1 });
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockResolvedValue(updatedSkillC),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, plannerAgent } = buildDeps(store, initialRun, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }],
      }),
    );

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unclear" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-c");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(updatedSkillC);
  });

  it("logs a warning and continues updating remaining skills when a metric update throws", async () => {
    const store: TestStore = {
      runState: RunState.ReadyForHumanReview,
      artifacts: [],
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-bad", "skill-good"] },
          createdAt: new Date(),
        },
      ],
    };
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const updatedGood = makeSkill({ id: "skill-good" });
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockImplementation((id: string) =>
        id === "skill-bad" ? Promise.reject(new Error("db down")) : Promise.resolve(updatedGood),
      ),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, logger } = buildDeps(store, initialRun, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-bad", error: "db down" }),
      expect.stringContaining("Failed to update skill metric"),
    );
    // The second (working) skill is still processed despite the first one throwing.
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-good");
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(updatedGood);
  });

  it("does nothing when the run reaches a terminal state but no skills were ever injected", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [], events: [] };
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps } = buildDeps(store, initialRun, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.buildTaskBundle default branch resolution", () => {
  it("warns and uses the remote default branch when it differs from the configured value", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
    const initialRun = makeRun({ state: RunState.Todo, branchName: "ai/run-1" });
    const { deps, plannerAgent, githubClient, logger } = buildDeps(store, initialRun);
    (githubClient as unknown as { getDefaultBranch: ReturnType<typeof vi.fn> }).getDefaultBranch = vi
      .fn()
      .mockResolvedValue("develop");
    const svc = new OrchestratorService(deps as never);

    // Use a plan with a blocking question so we don't need to mock the plan-review chain.
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      }),
    );

    await svc.retryRun("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "develop" }),
      expect.stringContaining("Config defaultBranch differs from GitHub"),
    );
  });

  it("does not warn when the remote default branch matches the configured value", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
    const initialRun = makeRun({ state: RunState.Todo, branchName: "ai/run-1" });
    const { deps, plannerAgent, githubClient, logger } = buildDeps(store, initialRun);
    (githubClient as unknown as { getDefaultBranch: ReturnType<typeof vi.fn> }).getDefaultBranch = vi
      .fn()
      .mockResolvedValue("main");
    const svc = new OrchestratorService(deps as never);

    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      }),
    );

    await svc.retryRun("run-1");

    const mismatchWarn = logger.warn.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Config defaultBranch differs"),
    );
    expect(mismatchWarn).toBeUndefined();
  });
});

describe("OrchestratorService execution report comment formatting edge cases", () => {
  it("collapses the file list inside <details> when more than 8 files changed", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const initialRun = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
    });
    const { deps, executorAgent, linearClient } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: manyFiles }),
      prNumber: 1,
    });

    await svc.runExecution("run-1");

    const call = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(call?.[1]).toContain("<details>");
    expect(call?.[1]).toContain("Files changed (9)");
  });

  it("omits the files and notes sections entirely when there are none", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const initialRun = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
    });
    const { deps, executorAgent, linearClient } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: [], notes: [] }),
      prNumber: 1,
    });

    await svc.runExecution("run-1");

    const call = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(call?.[1]).not.toContain("Files changed");
    expect(call?.[1]).not.toContain("### Notes");
  });
});
