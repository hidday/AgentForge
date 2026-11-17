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
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
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

function buildDeps(overrides: Record<string, unknown> = {}, initialRun: Run = makeRun()) {
  let trackedRun: Run = initialRun;

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(trackedRun)),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((id: string, state: RunState) => {
      trackedRun = { ...trackedRun, id, state };
      return Promise.resolve(trackedRun);
    }),
    update: vi.fn().mockImplementation((id: string, data: Record<string, unknown>) => {
      trackedRun = { ...trackedRun, id, ...data };
      return Promise.resolve(trackedRun);
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
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
  };

  const githubClient = { getPRDiff: vi.fn() };

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

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const agentSkillRepo = {
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn(),
    incrementFailure: vi.fn(),
    archiveIfLowUtility: vi.fn(),
  };

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
      agentSkillRepo,
      logger,
      dashboardEmitter,
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    plannerAgent,
    agentSkillRepo,
  };
}

describe("OrchestratorService.rejectPlan -- blocking questions after re-plan", () => {
  it("pauses for human clarification instead of running plan review when the rejected-then-replanned plan still has blocking open questions", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const { deps, artifactRepo, plannerAgent, eventRepo } = buildDeps({}, run);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 3, openQuestions: [{ id: "q1", question: "Blocker?", requiredForExecution: true }] }),
    );
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.rejectPlan("run-1", "needs more detail", "api");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(runPlanReviewSpy).not.toHaveBeenCalled();
    const eventTypes = eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
  });
});

describe("OrchestratorService.answerQuestions -- repeat clarification loop (below max iterations)", () => {
  it("transitions back to HumanClarificationNeeded with an incremented iteration count when blockers remain and the max has not been reached", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const { deps, artifactRepo, plannerAgent, eventRepo } = buildDeps({}, run);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }],
    });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "TaskBundle")
        return Promise.resolve(
          makeArtifact({
            type: "TaskBundle",
            payloadJson: {
              issue: { id: "LIN-1", title: "T", description: "D", labels: [], priority: 0 },
              repo: {
                name: "test-repo",
                defaultBranch: "main",
                workingBranch: "ai/run-1",
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
            },
          }),
        );
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }] }),
    );
    // Only 1 prior NEEDS_HUMAN_CLARIFICATION event -- below MAX_CLARIFICATION_ITERATIONS (3).
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      },
    ]);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still not sure" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const clarificationCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION,
    );
    expect(clarificationCall).toBeDefined();
    expect((clarificationCall![0] as { payloadJson: { iteration: number } }).payloadJson.iteration).toBe(2);
  });
});

describe("OrchestratorService -- skill injection recorded when relevant skills are found", () => {
  it("records a SKILL_INJECTION event with the matched skill IDs when retrying a run", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: "ai/run-1" });
    const { deps, plannerAgent, agentSkillRepo, eventRepo } = buildDeps({}, run);
    const svc = new OrchestratorService(deps as never);

    agentSkillRepo.findTopKByRelevance.mockResolvedValue([
      { id: "skill-1", repo: "test-repo", title: "Known fix", body: "...", successCount: 3, failureCount: 0 },
      { id: "skill-2", repo: "test-repo", title: "Another fix", body: "...", successCount: 1, failureCount: 0 },
    ]);
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview").mockResolvedValue(run);

    await svc.retryRun("run-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Fix the thing"),
      expect.any(Number),
    );
    const injectionCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionCall).toBeDefined();
    expect((injectionCall![0] as { payloadJson: { skillIds: string[] } }).payloadJson.skillIds).toEqual([
      "skill-1",
      "skill-2",
    ]);
    runPlanReviewSpy.mockRestore();
  });
});
