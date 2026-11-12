import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
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

interface TestStore {
  runState: RunState;
  planVersion: number;
  branchName: string | null;
  workingDirectory: string;
}

/**
 * A stateful fake for runRepo: findById/update/updateState all read and
 * write through a shared mutable `store`, so a run's state/planVersion
 * carried across several transitionAndRecord calls inside one orchestrator
 * method reflects reality, the same way the real repository would.
 */
function buildDeps(initialRun: Run, store: TestStore) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({
        ...initialRun,
        state: store.runState,
        planVersion: store.planVersion,
        branchName: store.branchName,
        workingDirectory: store.workingDirectory,
      }),
    ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({
        ...initialRun,
        state: newState,
        planVersion: store.planVersion,
        branchName: store.branchName,
        workingDirectory: store.workingDirectory,
      });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      if (patch.planVersion !== undefined) store.planVersion = patch.planVersion;
      if (patch.branchName !== undefined) store.branchName = patch.branchName;
      if (patch.workingDirectory !== undefined) store.workingDirectory = patch.workingDirectory;
      return Promise.resolve({
        ...initialRun,
        state: store.runState,
        planVersion: store.planVersion,
        branchName: store.branchName,
        workingDirectory: store.workingDirectory,
      });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
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
    run: vi.fn().mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] }),
  };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-retry" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
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
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    planReviewerAgent,
    gitService,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("re-plans with the previous Plan/RejectionContext/HumanAnswers/ResearchedAnswers/PlanReview context, then proceeds to plan review when no blockers remain", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    const store: TestStore = {
      runState: RunState.Planning,
      planVersion: 1,
      branchName: null,
      workingDirectory: "/tmp",
    };
    const { deps, artifactRepo, linearClient, plannerAgent, planReviewerAgent } = buildDeps(
      initialRun,
      store,
    );
    const svc = new OrchestratorService(deps as never);

    const previousPlan = makePlan({ planVersion: 1 });
    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "RejectionContext") {
        return Promise.resolve(
          asArtifact("RejectionContext", 1, { planVersion: 1, feedback: "Be careful", source: "api" }),
        );
      }
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, previousPlan));
      if (type === "HumanAnswers") {
        return Promise.resolve(
          asArtifact("HumanAnswers", 1, { answers: [{ questionId: "q1", answer: "yes" }] }),
        );
      }
      if (type === "ResearchedAnswers") {
        return Promise.resolve(
          asArtifact("ResearchedAnswers", 1, {
            summary: "s",
            answers: [{ questionId: "q2", question: "Q2?", answer: "A2", confidence: "high" }],
            completedAt: "2026-01-01T00:00:00Z",
          }),
        );
      }
      if (type === "PlanReview") {
        return Promise.resolve(
          asArtifact("PlanReview", 1, { summary: "review summary", findings: [] }),
        );
      }
      return Promise.resolve(null);
    });

    plannerAgent.run.mockResolvedValue(newPlan);

    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 2,
        previousPlan,
        humanFeedback: { planVersion: 1, feedback: "Be careful" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [
          { questionId: "q2", question: "Q2?", answer: "A2", confidence: "high" },
        ],
        planReviewFindings: { summary: "review summary", findings: [] },
      }),
    );

    expect(planReviewerAgent.run).toHaveBeenCalled();
    expect(linearClient.getIssue).toHaveBeenCalledWith("LIN-1");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for human clarification when the re-plan still has blocking open questions", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    const store: TestStore = {
      runState: RunState.Planning,
      planVersion: 1,
      branchName: null,
      workingDirectory: "/tmp",
    };
    const { deps, plannerAgent, planReviewerAgent, eventRepo } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const blockingPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Need input?", requiredForExecution: true }],
    });

    plannerAgent.run.mockResolvedValue(blockingPlan);

    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();

    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
  });
});

describe("OrchestratorService.retryRun", () => {
  it("re-establishes the git worktree when the run has no branchName, then plans and reviews", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.Todo, branchName: null });
    const store: TestStore = {
      runState: RunState.Todo,
      planVersion: 1,
      branchName: null,
      workingDirectory: "/tmp",
    };
    const { deps, artifactRepo, plannerAgent, planReviewerAgent, gitService } = buildDeps(
      initialRun,
      store,
    );
    const svc = new OrchestratorService(deps as never);

    const newPlan = makePlan({ planVersion: 1, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? asArtifact("Plan", 1, newPlan) : null),
    );

    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalledWith("/tmp", "run-1", "main", "ai/lin-1");
    expect(planReviewerAgent.run).toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.Todo,
      branchName: "ai/already-exists",
    });
    const store: TestStore = {
      runState: RunState.Todo,
      planVersion: 1,
      branchName: "ai/already-exists",
      workingDirectory: "/tmp",
    };
    const { deps, artifactRepo, plannerAgent, gitService } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const newPlan = makePlan({ planVersion: 1, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? asArtifact("Plan", 1, newPlan) : null),
    );

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for human clarification when the retried plan has blocking open questions", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.Todo,
      branchName: "ai/already-exists",
    });
    const store: TestStore = {
      runState: RunState.Todo,
      planVersion: 1,
      branchName: "ai/already-exists",
      workingDirectory: "/tmp",
    };
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const blockingPlan = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Need input?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(blockingPlan);

    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
  });
});
