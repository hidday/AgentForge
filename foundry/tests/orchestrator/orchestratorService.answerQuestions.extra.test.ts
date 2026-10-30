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
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.HumanClarificationNeeded,
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
    openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
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
  let current: Run = initialRun;

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(current)),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
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
    findLatestByType: vi.fn().mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "TaskBundle") return Promise.resolve(makeArtifact({ type: "TaskBundle", payloadJson: {} }));
      return Promise.resolve(null);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = { getIssue: vi.fn(), postComment: vi.fn().mockResolvedValue(undefined), getRelatedContext: vi.fn() };
  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn(),
  };
  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };
  const plannerAgent = { run: vi.fn().mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] })) };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn(),
    commitAndPush: vi.fn(),
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

describe("OrchestratorService.answerQuestions — extra error/boundary branches", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const { deps, artifactRepo } = buildDeps();
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "x" }]),
    ).rejects.toThrow(/No plan artifact found/);
  });

  it("throws when no TaskBundle artifact exists after transitioning out of HumanClarificationNeeded", async () => {
    const { deps, artifactRepo } = buildDeps();
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "Prod" }]),
    ).rejects.toThrow(/No TaskBundle artifact found/);
  });

  it("re-pauses for clarification (without failing) when the re-plan still has blockers and iteration count is below the max", async () => {
    const { deps, plannerAgent, eventRepo } = buildDeps();
    // One prior NEEDS_HUMAN_CLARIFICATION event -- below MAX_CLARIFICATION_ITERATIONS (3).
    eventRepo.findByRunId.mockResolvedValue([
      { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION },
    ]);
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q2", question: "Still unclear?", requiredForExecution: true }] }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "Prod" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });

  it("fails the run with CLARIFICATION_EXHAUSTED when the re-plan still has blockers at max iterations", async () => {
    const { deps, plannerAgent, eventRepo } = buildDeps();
    eventRepo.findByRunId.mockResolvedValue([
      { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION },
      { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION },
      { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION },
    ]);
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q2", question: "Still unclear?", requiredForExecution: true }] }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "Prod" }]);

    expect(result.state).toBe(RunState.Failed);
  });
});
