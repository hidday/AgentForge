import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "a".repeat(250),
    linearIssueTitle: "Title",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
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
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeSkill(id: string) {
  return {
    id,
    repoSlug: "test-repo",
    name: `skill-${id}`,
    description: null,
    taskCategory: "testing",
    skillMarkdown: "# skill",
    utilityScore: 0,
    lastUsedAt: new Date().toISOString(),
  };
}

function buildDeps(overrides: Record<string, unknown> = {}, initialRun: Run = makeRun()) {
  let current: Run = initialRun;

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(current)),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn(),
    create: vi.fn().mockImplementation((params: Partial<Run>) => {
      current = makeRun({ ...params, id: "run-1" });
      return Promise.resolve(current);
    }),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, state: RunState) => {
      current = { ...current, state };
      return Promise.resolve(current);
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      current = { ...current, ...patch };
      return Promise.resolve(current);
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
      branchName: "ai/run-1",
      labels: [] as string[],
      priority: 0,
      url: null,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ parent: undefined, blockers: [] }),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main") };
  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
    validateWorkingDirectory: vi.fn().mockReturnValue(undefined),
    getRepoByName: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };
  const plannerAgent = { run: vi.fn().mockResolvedValue(makePlan()) };
  const planReviewerAgent = { run: vi.fn() };
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
    plannerAgent,
  };
}

describe("OrchestratorService.retrieveSkillsForPlanning (via startRun)", () => {
  it("does nothing when no agentSkillRepo dependency is configured", async () => {
    const { deps } = buildDeps({ agentSkillRepo: undefined });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.startRun("LIN-1");

    expect(deps.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      { priorSkills: [] },
    );
  });

  it("queries by issue title + truncated description and records a SKILL_INJECTION event when skills are found", async () => {
    const skills = [makeSkill("skill-1"), makeSkill("skill-2")];
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue(skills) };
    const { deps, eventRepo, plannerAgent } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Test"),
      expect.any(Number),
    );
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "SKILL_INJECTION",
        payloadJson: { skillIds: ["skill-1", "skill-2"] },
      }),
    );
    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      { priorSkills: skills },
    );
  });

  it("does not record a SKILL_INJECTION event when no skills are found", async () => {
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue([]) };
    const { deps, eventRepo } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.startRun("LIN-1");

    expect(
      eventRepo.create.mock.calls.some((c: unknown[]) => (c[0] as { eventType?: string }).eventType === "SKILL_INJECTION"),
    ).toBe(false);
  });
});

describe("OrchestratorService.updateSkillMetrics (via terminal-state transitions)", () => {
  function approveHumanReviewDeps(agentSkillRepo?: Record<string, unknown>) {
    return buildDeps(
      { agentSkillRepo, distillationAgent: undefined },
      makeRun({ state: RunState.ReadyForHumanReview }),
    );
  }

  it("does nothing when no agentSkillRepo dependency is configured", async () => {
    const { deps, eventRepo } = approveHumanReviewDeps(undefined);
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(eventRepo.findByRunId).not.toHaveBeenCalled();
  });

  it("does nothing when the run has no SKILL_INJECTION events", async () => {
    const agentSkillRepo = { incrementSuccess: vi.fn(), incrementFailure: vi.fn(), archiveIfLowUtility: vi.fn() };
    const { deps, eventRepo } = approveHumanReviewDeps(agentSkillRepo);
    eventRepo.findByRunId.mockResolvedValue([{ eventType: "PLAN_CREATED" }]);
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("increments success and archives-if-low-utility for each deduplicated injected skill on a Done transition", async () => {
    const updatedSkill = makeSkill("skill-1");
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockResolvedValue(updatedSkill),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, eventRepo } = approveHumanReviewDeps(agentSkillRepo);
    eventRepo.findByRunId.mockResolvedValue([
      { eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1", "skill-2"] } },
      { eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-2"] } },
    ]);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(updatedSkill);
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });

  it("increments failure for each injected skill on a Failed transition", async () => {
    const agentSkillRepo = {
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockResolvedValue(makeSkill("skill-1")),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, eventRepo, artifactRepo, plannerAgent } = buildDeps(
      { agentSkillRepo },
      makeRun({ state: RunState.HumanClarificationNeeded }),
    );
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan")
        return Promise.resolve(
          makeArtifact({
            type: "Plan",
            payloadJson: makePlan({
              openQuestions: [{ id: "q1", question: "?", requiredForExecution: true }],
            }),
          }),
        );
      if (type === "TaskBundle") return Promise.resolve(makeArtifact({ type: "TaskBundle", payloadJson: {} }));
      return Promise.resolve(null);
    });
    eventRepo.findByRunId.mockResolvedValue([
      { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION },
      { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION },
      { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION },
      { eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } },
    ]);
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "?", requiredForExecution: true }] }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "x" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("logs a warning and continues when updating one skill's metric throws", async () => {
    const agentSkillRepo = {
      incrementSuccess: vi
        .fn()
        .mockRejectedValueOnce(new Error("db down"))
        .mockResolvedValueOnce(makeSkill("skill-2")),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, eventRepo } = approveHumanReviewDeps(agentSkillRepo);
    eventRepo.findByRunId.mockResolvedValue([
      { eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1", "skill-2"] } },
    ]);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    // archiveIfLowUtility should still run for the second (successful) skill.
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(1);
  });
});

describe("OrchestratorService.maybeResearchAndReplan (via startRun)", () => {
  it("passes prior human answers into both the researcher and the follow-up planner call", async () => {
    const answerResearcherAgent = {
      run: vi.fn().mockResolvedValue({
        summary: "researched",
        answers: [{ questionId: "q1", question: "?", answer: "x", confidence: "high" }],
        completedAt: new Date().toISOString(),
      }),
    };
    const humanAnswers = [{ questionId: "q1", answer: "Prod" }];
    const { deps, artifactRepo, plannerAgent } = buildDeps({ answerResearcherAgent });
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "HumanAnswers") {
        return Promise.resolve(makeArtifact({ type: "HumanAnswers", payloadJson: { answers: humanAnswers } }));
      }
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValueOnce(
      makePlan({ openQuestions: [{ id: "q1", question: "?", requiredForExecution: false }] }),
    );
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.startRun("LIN-1");

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { humanAnswers },
    );
    expect(plannerAgent.run).toHaveBeenLastCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ humanAnswers }),
    );
  });
});
