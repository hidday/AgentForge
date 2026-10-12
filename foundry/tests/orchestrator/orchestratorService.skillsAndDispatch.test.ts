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
    openQuestions: [{ id: "q1", question: "Blocker?", requiredForExecution: true }],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeSkill(id: string): SkillDocument {
  return {
    id,
    repoSlug: "test-repo",
    name: `Skill ${id}`,
    description: "A skill",
    taskCategory: "general",
    skillMarkdown: "# skill",
    utilityScore: 0.5,
    lastUsedAt: new Date(),
  };
}

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version}-${Math.random()}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: new Date(),
  };
}

// --- retrieveSkillsForPlanning (exercised via startRun) ---------------------

function buildStartRunDeps(
  agentSkillRepo?: Record<string, unknown>,
  issueTitleAndDescription: { linearIssueTitle: string | null; linearIssueDescription: string | null } = {
    linearIssueTitle: "Fix the thing",
    linearIssueDescription: "A description of the bug",
  },
) {
  const todoRun = makeRun({ state: RunState.Todo, ...issueTitleAndDescription });
  const planningRun = makeRun({ state: RunState.Planning, planVersion: 1, ...issueTitleAndDescription });
  const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 1 });
  const clarificationRun = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });

  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn(),
    create: vi.fn().mockResolvedValue(todoRun),
    findByIssueId: vi.fn(),
    updateState: vi
      .fn()
      .mockResolvedValueOnce(planningRun)
      .mockResolvedValueOnce(planReviewRun)
      .mockResolvedValueOnce(clarificationRun),
    update: vi.fn().mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" }).mockResolvedValue(planningRun),
  };
  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };
  const events: RunEventRecord[] = [];
  const eventRepo = {
    create: vi.fn().mockImplementation((params: { eventType: string; source: string; payloadJson?: unknown; runId: string }) => {
      const rec: RunEventRecord = { id: `event-${events.length}`, runId: params.runId, eventType: params.eventType, source: params.source, payloadJson: params.payloadJson ?? {}, createdAt: new Date() };
      events.push(rec);
      return Promise.resolve(rec);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...events])),
  };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({ id: "LIN-1", title: "Fix the thing", description: "A description of the bug", branchName: "ai/run-1", labels: [], priority: 0 }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };
  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main") };
  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue({
      name: "test-repo", defaultBranch: "main", allowedPaths: ["src/"], protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(null),
    getDefaultRepo: vi.fn().mockReturnValue({
      name: "test-repo", defaultBranch: "main", allowedPaths: ["src/"], protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
  };
  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn(),
    commitAndPush: vi.fn(),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
  };
  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };
  const plannerAgent = { run: vi.fn().mockResolvedValue(makePlan()) };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const dashboardEmitter = { emitStateChanged: vi.fn(), emitArtifactCreated: vi.fn(), emitRunCreated: vi.fn(), emitQuestionsAnswered: vi.fn() };

  return {
    deps: {
      runRepo, artifactRepo, eventRepo, linearClient, githubClient, gitService, repoRegistry,
      linearSync, githubSync, plannerAgent, planReviewerAgent, planReviserAgent, executorAgent,
      reviewerAgent, remediationAgent, logger, dashboardEmitter, agentSkillRepo,
    },
    eventRepo,
    plannerAgent,
  };
}

describe("OrchestratorService -- retrieveSkillsForPlanning (via startRun)", () => {
  it("injects top-k relevant skills, records a SKILL_INJECTION event, and forwards them to the planner", async () => {
    const skills = [makeSkill("skill-1"), makeSkill("skill-2")];
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue(skills) };
    const { deps, eventRepo, plannerAgent } = buildStartRunDeps(agentSkillRepo);
    const svc = new OrchestratorService(deps as never);

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith("test-repo", expect.stringContaining("Fix the thing"), 3);
    expect(plannerAgent.run).toHaveBeenCalledWith(expect.anything(), "run-1", { priorSkills: skills });

    const injectionEvent = (eventRepo.create.mock.calls as unknown[][]).find(
      (c) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvent).toBeDefined();
    expect((injectionEvent![0] as { payloadJson: { skillIds: string[] } }).payloadJson.skillIds).toEqual([
      "skill-1",
      "skill-2",
    ]);
  });

  it("does not record a SKILL_INJECTION event when no skills are found", async () => {
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue([]) };
    const { deps, eventRepo } = buildStartRunDeps(agentSkillRepo);
    const svc = new OrchestratorService(deps as never);

    await svc.startRun("LIN-1");

    const injectionEvent = (eventRepo.create.mock.calls as unknown[][]).find(
      (c) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvent).toBeUndefined();
  });

  it("skips skill retrieval entirely when no agentSkillRepo is configured", async () => {
    const { deps, plannerAgent } = buildStartRunDeps(undefined);
    const svc = new OrchestratorService(deps as never);

    await svc.startRun("LIN-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(expect.anything(), "run-1", { priorSkills: [] });
  });

  it("builds a safe query (empty-string fallbacks) when the run has no linearIssueTitle/linearIssueDescription", async () => {
    const skills = [makeSkill("skill-1")];
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue(skills) };
    const { deps } = buildStartRunDeps(agentSkillRepo, { linearIssueTitle: null, linearIssueDescription: null });
    const svc = new OrchestratorService(deps as never);

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith("test-repo", " ", 3);
  });
});

// --- updateSkillMetrics (exercised via the Done/Failed transitionAndRecord path) ---

function buildTerminalDeps(opts: {
  agentSkillRepo?: {
    incrementSuccess: ReturnType<typeof vi.fn>;
    incrementFailure: ReturnType<typeof vi.fn>;
    archiveIfLowUtility: ReturnType<typeof vi.fn>;
  };
  injectionEvents?: RunEventRecord[];
  worktreeDiffersFromMain?: boolean;
}) {
  const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree" });
  const runRepo = {
    findById: vi.fn().mockResolvedValue(run),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockResolvedValue({ ...run, state: RunState.Done }),
    update: vi.fn(),
  };
  const artifactRepo = { create: vi.fn(), findByRunId: vi.fn(), findLatestByType: vi.fn().mockResolvedValue(null) };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue(opts.injectionEvents ?? []) };
  const linearClient = { getIssue: vi.fn(), postComment: vi.fn().mockResolvedValue(undefined) };
  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn(),
    commitAndPush: vi.fn(),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue(opts.worktreeDiffersFromMain ? "/tmp/main-repo" : "/tmp/worktree"),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const deps = {
    runRepo, artifactRepo, eventRepo, linearClient,
    githubClient: { getPRDiff: vi.fn() },
    gitService,
    repoRegistry: { resolveForIssue: vi.fn(), resolveWorkingDirectory: vi.fn(), validateWorkingDirectory: vi.fn(), getRepoByName: vi.fn(), getDefaultRepo: vi.fn() },
    linearSync: { syncState: vi.fn().mockResolvedValue(undefined) },
    githubSync: { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() },
    plannerAgent: { run: vi.fn() },
    planReviewerAgent: { run: vi.fn() },
    planReviserAgent: { run: vi.fn() },
    executorAgent: { run: vi.fn() },
    reviewerAgent: { run: vi.fn() },
    remediationAgent: { run: vi.fn() },
    logger,
    agentSkillRepo: opts.agentSkillRepo,
  };
  return { deps, gitService, logger };
}

describe("OrchestratorService -- updateSkillMetrics and worktree cleanup (via approveHumanReview -> Done)", () => {
  it("increments success and archives low-utility skills for each unique injected skill id, deduplicated across events", async () => {
    const incrementSuccess = vi.fn().mockImplementation((id: string) => Promise.resolve({ id, utilityScore: 0.5 }));
    const archiveIfLowUtility = vi.fn().mockResolvedValue(undefined);
    const incrementFailure = vi.fn();
    const injectionEvents: RunEventRecord[] = [
      { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["s1", "s2"] }, createdAt: new Date() },
      { id: "e2", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["s2", "s3"] }, createdAt: new Date() },
    ];
    const { deps } = buildTerminalDeps({
      agentSkillRepo: { incrementSuccess, incrementFailure, archiveIfLowUtility },
      injectionEvents,
      worktreeDiffersFromMain: true,
    });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(incrementSuccess).toHaveBeenCalledTimes(3);
    expect(incrementSuccess.mock.calls.map((c) => c[0]).sort()).toEqual(["s1", "s2", "s3"]);
    expect(incrementFailure).not.toHaveBeenCalled();
    expect(archiveIfLowUtility).toHaveBeenCalledTimes(3);
  });

  it("removes the worktree when it differs from the main repo path", async () => {
    const { deps, gitService } = buildTerminalDeps({ worktreeDiffersFromMain: true });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).toHaveBeenCalledWith("/tmp/main-repo", "/tmp/worktree");
  });

  it("skips worktree removal when the resolved main repo path equals the run's working directory", async () => {
    const { deps, gitService } = buildTerminalDeps({ worktreeDiffersFromMain: false });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("does nothing when there are no SKILL_INJECTION events for the run", async () => {
    const incrementSuccess = vi.fn();
    const archiveIfLowUtility = vi.fn();
    const { deps } = buildTerminalDeps({
      agentSkillRepo: { incrementSuccess, incrementFailure: vi.fn(), archiveIfLowUtility },
      injectionEvents: [],
    });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(incrementSuccess).not.toHaveBeenCalled();
    expect(archiveIfLowUtility).not.toHaveBeenCalled();
  });

  it("tolerates a malformed SKILL_INJECTION event with no skillIds field (treats it as contributing no ids)", async () => {
    const incrementSuccess = vi.fn();
    const archiveIfLowUtility = vi.fn();
    const malformedEvent: RunEventRecord = {
      id: "e1",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: {},
      createdAt: new Date(),
    };
    const { deps } = buildTerminalDeps({
      agentSkillRepo: { incrementSuccess, incrementFailure: vi.fn(), archiveIfLowUtility },
      injectionEvents: [malformedEvent],
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(incrementSuccess).not.toHaveBeenCalled();
    expect(archiveIfLowUtility).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.Done);
  });

  it("does nothing when no agentSkillRepo is configured", async () => {
    const { deps } = buildTerminalDeps({ agentSkillRepo: undefined });
    const svc = new OrchestratorService(deps as never);

    // Should not throw even though agentSkillRepo is undefined.
    const result = await svc.approveHumanReview("run-1");
    expect(result.state).toBe(RunState.Done);
  });

  it("logs a warning and continues with the remaining skill ids when incrementSuccess throws for one", async () => {
    const incrementSuccess = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error("db down")))
      .mockImplementationOnce((id: string) => Promise.resolve({ id, utilityScore: 0.9 }));
    const archiveIfLowUtility = vi.fn().mockResolvedValue(undefined);
    const injectionEvents: RunEventRecord[] = [
      { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["bad-skill", "good-skill"] }, createdAt: new Date() },
    ];
    const { deps, logger } = buildTerminalDeps({
      agentSkillRepo: { incrementSuccess, incrementFailure: vi.fn(), archiveIfLowUtility },
      injectionEvents,
    });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "bad-skill", error: "db down" }),
      expect.stringContaining("Failed to update skill metric"),
    );
    // archiveIfLowUtility is only reached for the id that succeeded.
    expect(archiveIfLowUtility).toHaveBeenCalledTimes(1);
    expect(archiveIfLowUtility).toHaveBeenCalledWith({ id: "good-skill", utilityScore: 0.9 });
  });

  it("increments failure (not success) for injected skills when the run transitions to Failed", async () => {
    const incrementSuccess = vi.fn();
    const incrementFailure = vi.fn().mockImplementation((id: string) => Promise.resolve({ id, utilityScore: 0.1 }));
    const archiveIfLowUtility = vi.fn().mockResolvedValue(undefined);

    const run = makeRun({ state: RunState.HumanClarificationNeeded, workingDirectory: "/tmp/worktree" });
    const plan = makePlan({ openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }] });
    const taskBundle = {
      issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
      repo: { name: "test-repo", defaultBranch: "main", workingBranch: "ai/run-1", repoPath: "/tmp", allowedPaths: ["src/"], protectedPaths: [] },
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
      definitionOfDone: [],
    };
    let currentState = run.state;
    const runRepo = {
      findById: vi.fn().mockImplementation(() => Promise.resolve({ ...run, state: currentState })),
      findActiveByIssueId: vi.fn(),
      findAll: vi.fn(),
      create: vi.fn(),
      findByIssueId: vi.fn(),
      updateState: vi
        .fn()
        .mockImplementationOnce(() => {
          currentState = RunState.Planning;
          return Promise.resolve({ ...run, state: currentState });
        })
        .mockImplementationOnce(() => {
          currentState = RunState.PlanReview;
          return Promise.resolve({ ...run, state: currentState });
        })
        .mockImplementationOnce(() => {
          currentState = RunState.Failed;
          return Promise.resolve({ ...run, state: currentState });
        }),
      update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => Promise.resolve({ ...run, state: currentState, planVersion: 2, ...patch })),
    };
    const artifactRepo = {
      create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
      findByRunId: vi.fn(),
      findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(asArtifact({ type: "Plan", version: 1, payloadJson: plan }));
        if (type === "TaskBundle") return Promise.resolve(asArtifact({ type: "TaskBundle", version: 1, payloadJson: taskBundle }));
        return Promise.resolve(null);
      }),
    };
    const injectionEvents: RunEventRecord[] = [
      { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["s1"] }, createdAt: new Date() },
      {
        id: "e2",
        runId: "run-1",
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      },
      { id: "e3", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e4", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
    ];
    const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue(injectionEvents) };
    const deps = {
      runRepo,
      artifactRepo,
      eventRepo,
      linearClient: { getIssue: vi.fn(), postComment: vi.fn().mockResolvedValue(undefined) },
      githubClient: { getPRDiff: vi.fn() },
      gitService: { setupRunWorktree: vi.fn(), assertBranch: vi.fn(), commitAndPush: vi.fn(), removeWorktree: vi.fn().mockResolvedValue(undefined), resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/worktree") },
      repoRegistry: { resolveForIssue: vi.fn(), resolveWorkingDirectory: vi.fn(), validateWorkingDirectory: vi.fn(), getRepoByName: vi.fn(), getDefaultRepo: vi.fn() },
      linearSync: { syncState: vi.fn().mockResolvedValue(undefined) },
      githubSync: { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() },
      plannerAgent: { run: vi.fn().mockResolvedValue(plan) },
      planReviewerAgent: { run: vi.fn() },
      planReviserAgent: { run: vi.fn() },
      executorAgent: { run: vi.fn() },
      reviewerAgent: { run: vi.fn() },
      remediationAgent: { run: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      agentSkillRepo: { incrementSuccess, incrementFailure, archiveIfLowUtility },
    };
    const svc = new OrchestratorService(deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unclear" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(incrementFailure).toHaveBeenCalledWith("s1");
    expect(incrementSuccess).not.toHaveBeenCalled();
    expect(archiveIfLowUtility).toHaveBeenCalledWith({ id: "s1", utilityScore: 0.1 });
  });
});

// --- Getters ------------------------------------------------------------

describe("OrchestratorService -- simple getters", () => {
  it("exposes the injected repositories and clients unchanged", () => {
    const runRepo = {} as never;
    const artifactRepo = {} as never;
    const eventRepo = {} as never;
    const agentSkillRepo = {} as never;
    const linearClient = {} as never;
    const svc = new OrchestratorService({
      runRepo,
      artifactRepo,
      eventRepo,
      linearClient,
      githubClient: {} as never,
      gitService: {} as never,
      repoRegistry: {} as never,
      linearSync: {} as never,
      githubSync: {} as never,
      plannerAgent: {} as never,
      planReviewerAgent: {} as never,
      planReviserAgent: {} as never,
      executorAgent: {} as never,
      reviewerAgent: {} as never,
      remediationAgent: {} as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      agentSkillRepo,
    } as never);

    expect(svc.getRunRepo()).toBe(runRepo);
    expect(svc.getArtifactRepo()).toBe(artifactRepo);
    expect(svc.getEventRepo()).toBe(eventRepo);
    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
    expect(svc.getLinearClient()).toBe(linearClient);
  });
});

// --- handleLinearWebhook / handleCommand dispatch ------------------------

function buildDispatchDeps() {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };
  const deps = {
    runRepo,
    artifactRepo: { create: vi.fn(), findByRunId: vi.fn(), findLatestByType: vi.fn() },
    eventRepo: { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) },
    linearClient: { getIssue: vi.fn(), postComment: vi.fn() },
    githubClient: { getPRDiff: vi.fn() },
    gitService: { setupRunWorktree: vi.fn(), assertBranch: vi.fn(), commitAndPush: vi.fn(), removeWorktree: vi.fn(), resolveMainRepoPath: vi.fn() },
    repoRegistry: { resolveForIssue: vi.fn(), resolveWorkingDirectory: vi.fn(), validateWorkingDirectory: vi.fn(), getRepoByName: vi.fn(), getDefaultRepo: vi.fn() },
    linearSync: { syncState: vi.fn().mockResolvedValue(undefined) },
    githubSync: { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() },
    plannerAgent: { run: vi.fn() },
    planReviewerAgent: { run: vi.fn() },
    planReviserAgent: { run: vi.fn() },
    executorAgent: { run: vi.fn() },
    reviewerAgent: { run: vi.fn() },
    remediationAgent: { run: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
  return { deps, runRepo, logger: deps.logger };
}

describe("OrchestratorService.handleLinearWebhook", () => {
  it("dispatches comment.command with a command to handleCommand", async () => {
    const { deps } = buildDispatchDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1", command: { type: "ai-plan" } });

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", { type: "ai-plan" });
  });

  it("does not dispatch comment.command without a command payload", async () => {
    const { deps } = buildDispatchDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("no-ops for issue.created and issue.updated actions", async () => {
    const { deps } = buildDispatchDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });
    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it("ai-plan and run-ai both dispatch to startRun", async () => {
    const { deps } = buildDispatchDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue({} as Run);

    await svc.handleCommand("LIN-1", { type: "ai-plan" });
    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(startRunSpy).toHaveBeenCalledTimes(2);
    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan: approves then triggers execution when an active run is found", async () => {
    const { deps, runRepo } = buildDispatchDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-9" }));
    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue({} as Run);
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue({} as Run);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).toHaveBeenCalledWith("run-9");
    expect(runExecutionSpy).toHaveBeenCalledWith("run-9");
  });

  it("approve-plan: does nothing when no active run is found", async () => {
    const { deps, runRepo } = buildDispatchDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue({} as Run);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).not.toHaveBeenCalled();
  });

  it("reject-plan: dispatches with the command body when a run is found", async () => {
    const { deps, runRepo } = buildDispatchDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-9" }));
    const svc = new OrchestratorService(deps as never);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue({} as Run);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "no good" });

    expect(rejectPlanSpy).toHaveBeenCalledWith("run-9", "no good", "linear");
  });

  it("reject-plan: does nothing when no run is found", async () => {
    const { deps, runRepo } = buildDispatchDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue({} as Run);

    await svc.handleCommand("LIN-1", { type: "reject-plan" });

    expect(rejectPlanSpy).not.toHaveBeenCalled();
  });

  it("re-review: dispatches to runReview when a run is found", async () => {
    const { deps, runRepo } = buildDispatchDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-9" }));
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue({} as Run);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).toHaveBeenCalledWith("run-9");
  });

  it("re-review: does nothing when no run is found", async () => {
    const { deps, runRepo } = buildDispatchDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue({} as Run);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).not.toHaveBeenCalled();
  });

  it("pause-ai: transitions a found run to AIBlocked via BLOCKED", async () => {
    const { deps, runRepo } = buildDispatchDeps();
    const run = makeRun({ id: "run-9", state: RunState.Implementing });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.AIBlocked });
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(runRepo.updateState).toHaveBeenCalledWith("run-9", RunState.AIBlocked);
    const eventTypes = (deps.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.BLOCKED);
  });

  it("pause-ai: does nothing when no run is found", async () => {
    const { deps, runRepo } = buildDispatchDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("resume-ai: transitions a found run back to Todo via RESET_TO_TODO", async () => {
    const { deps, runRepo } = buildDispatchDeps();
    const run = makeRun({ id: "run-9", state: RunState.AIBlocked });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.Todo });
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(runRepo.updateState).toHaveBeenCalledWith("run-9", RunState.Todo);
    const eventTypes = (deps.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.RESET_TO_TODO);
  });

  it("resume-ai: does nothing when no run is found", async () => {
    const { deps, runRepo } = buildDispatchDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("unknown: logs a warning and does nothing else", async () => {
    const { deps, logger } = buildDispatchDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/bogus" });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
  });
});
