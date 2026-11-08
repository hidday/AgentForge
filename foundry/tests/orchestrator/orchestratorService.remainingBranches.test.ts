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

function makeTaskBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "Test issue", description: "Test description", labels: [], priority: 0 },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp",
      allowedPaths: ["src/"],
      protectedPaths: [],
    },
    constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    definitionOfDone: [],
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

function makeEvent(overrides: Partial<RunEventRecord> & { eventType: string }): RunEventRecord {
  return { id: "event-1", runId: "run-1", source: "orchestrator", payloadJson: {}, createdAt: new Date(), ...overrides };
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };

  const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }), findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const eventRepo = { create: vi.fn().mockResolvedValue({ id: "event-new" }), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };
  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main") };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn().mockReturnValue({
      name: "default-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
  };
  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };
  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({ reviewId: "pr-1", overallVerdict: "approved", summary: "OK", findings: [] }),
  };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-test" }),
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
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

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
      distillationAgent,
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    plannerAgent,
    repoRegistry,
    logger,
    distillationAgent,
  };
}

describe("OrchestratorService -- repo registry fallback", () => {
  it("falls back to getDefaultRepo when getRepoByName returns nothing (retryRun's branchless worktree setup)", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, repoRegistry } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    repoRegistry.getRepoByName.mockReturnValue(null);

    const run = makeRun({ state: RunState.Todo, branchName: null, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update
      .mockResolvedValueOnce({ ...run, workingDirectory: "/tmp/worktree", branchName: "ai/run-test" }) // worktree setup (still Todo)
      .mockResolvedValue({ ...run, state: RunState.Planning, planVersion: 2 }); // planVersion update, post RUN_REQUESTED
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }));

    artifactRepo.findLatestByType.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));

    await svc.retryRun("run-1");

    expect(repoRegistry.getDefaultRepo).toHaveBeenCalled();
  });
});

describe("OrchestratorService.answerQuestions -- preserves prior researched answers on re-plan", () => {
  it("includes prior ResearchedAnswers when re-planning with newly submitted human answers", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const plan = makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] });
    const taskBundle = makeTaskBundle();

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Planning }));
    runRepo.update.mockResolvedValue({ ...run, state: RunState.Planning, planVersion: 2 });

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "TaskBundle") return Promise.resolve(asArtifact("TaskBundle", 1, taskBundle));
      if (type === "ResearchedAnswers")
        return Promise.resolve(
          asArtifact("ResearchedAnswers", 1, {
            summary: "prior",
            answers: [{ questionId: "q0", question: "Earlier?", answer: "Yes", confidence: "high" }],
            completedAt: "2026-01-01T00:00:00Z",
          }),
        );
      return Promise.resolve(null);
    });

    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));

    await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    expect(plannerAgent.run).toHaveBeenCalledWith(
      taskBundle,
      "run-1",
      expect.objectContaining({
        researchedAnswers: [{ questionId: "q0", question: "Earlier?", answer: "Yes", confidence: "high" }],
      }),
    );
  });
});

describe("OrchestratorService -- non-Error rejection handling", () => {
  it("buildTaskBundle tolerates a non-Error rejection from getDefaultBranch", async () => {
    const { deps, runRepo, artifactRepo, githubClient, logger, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    githubClient.getDefaultBranch.mockRejectedValue("network blip");

    const run = makeRun({ state: RunState.Todo, branchName: "ai/run-1", planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning }));

    artifactRepo.findLatestByType.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));

    await svc.retryRun("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "network blip" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
  });

  it("buildTaskBundle tolerates a non-Error rejection from getRelatedContext", async () => {
    const { deps, runRepo, artifactRepo, linearClient, logger, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    linearClient.getRelatedContext.mockRejectedValue({ code: 503 });

    const run = makeRun({ state: RunState.Todo, branchName: "ai/run-1", planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning }));

    artifactRepo.findLatestByType.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));

    await svc.retryRun("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1", error: "[object Object]" }),
      "Failed to fetch related Linear context; proceeding without it",
    );
  });

  it("approveHumanReview tolerates a non-Error rejection from the distillation agent", async () => {
    const { deps, runRepo, logger, distillationAgent } = buildDeps();
    distillationAgent.run.mockRejectedValue("distillation service down");
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation service down" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });
});

describe("OrchestratorService -- skill query construction and empty-injection guard", () => {
  it("retrieveSkillsForPlanning falls back to an empty title and still slices a present description", async () => {
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue([]) };
    const { deps, runRepo, artifactRepo, plannerAgent, repoRegistry } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    repoRegistry.getRepoByName.mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    });

    const run = makeRun({
      state: RunState.Todo,
      branchName: "ai/run-1",
      planVersion: 1,
      linearIssueTitle: null,
      linearIssueDescription: "A fairly long description of the bug that needs fixing.",
    });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce({ ...run, state: RunState.Planning })
      .mockResolvedValueOnce({ ...run, state: RunState.PlanReview });
    runRepo.update.mockResolvedValue({ ...run, state: RunState.Planning });

    artifactRepo.findLatestByType.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));

    await svc.retryRun("run-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("A fairly long description"),
      expect.any(Number),
    );
  });

  it("updateSkillMetrics logs a warning with a stringified error when incrementFailure rejects with a non-Error value", async () => {
    const agentSkillRepo = {
      incrementFailure: vi.fn().mockRejectedValue("db unavailable"),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent, logger } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const plan = makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] });
    const taskBundle = makeTaskBundle();

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.Failed }));
    runRepo.update.mockResolvedValue({ ...run, state: RunState.Planning, planVersion: 2 });

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "TaskBundle") return Promise.resolve(asArtifact("TaskBundle", 1, taskBundle));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }] }),
    );
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ id: "e1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
      makeEvent({ id: "e2", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
      makeEvent({ id: "e3", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
      makeEvent({ id: "e4", eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-z"] } }),
    ]);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unsure" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-z", error: "db unavailable" }),
      "Failed to update skill metric",
    );
  });

  it("updateSkillMetrics returns early without touching agentSkillRepo when there are no SKILL_INJECTION events", async () => {
    const agentSkillRepo = { incrementSuccess: vi.fn(), archiveIfLowUtility: vi.fn() };
    const { deps, runRepo, eventRepo } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    eventRepo.findByRunId.mockResolvedValue([makeEvent({ id: "e1", eventType: "SOME_OTHER_EVENT" })]);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).not.toHaveBeenCalled();
  });
});
