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

function makeTaskBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "Test issue", description: "Test description", labels: [], priority: 0 },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp/worktree",
      allowedPaths: ["src/"],
      protectedPaths: [],
    },
    constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    definitionOfDone: [],
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
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
    getDefaultRepo: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
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
    linearClient,
    logger,
  };
}

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run for the issue without creating a new one", async () => {
    const store: TestStore = { runState: RunState.Planning, artifacts: [], events: [] };
    const existingRun = makeRun({ id: "existing-run", state: RunState.Planning });
    const { deps, runRepo, linearClient } = buildDeps(store, existingRun);
    runRepo.findActiveByIssueId.mockResolvedValue(existingRun);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existingRun);
    expect(runRepo.create).not.toHaveBeenCalled();
    expect(linearClient.getIssue).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runPlanReview missing artifact", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const store: TestStore = { runState: RunState.PlanReview, artifacts: [], events: [] };
    const { deps } = buildDeps(store, makeRun({ state: RunState.PlanReview }));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.rejectPlan blocking-questions path", () => {
  it("pauses for human clarification instead of running plan review when the re-plan still has blockers", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const { deps, plannerAgent, runRepo } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      }),
    );

    const result = await svc.rejectPlan("run-1", "please redo", "api");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(runRepo.updateState).toHaveBeenLastCalledWith("run-1", RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.answerQuestions missing-artifact guards", () => {
  it("throws when the state is valid but no Plan artifact exists", async () => {
    const store: TestStore = { runState: RunState.HumanClarificationNeeded, artifacts: [], events: [] };
    const { deps } = buildDeps(store, makeRun({ state: RunState.HumanClarificationNeeded }));
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No plan artifact found/);
  });

  it("throws when no TaskBundle artifact exists after clarification is provided", async () => {
    const plan = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const store: TestStore = {
      runState: RunState.HumanClarificationNeeded,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps } = buildDeps(store, makeRun({ state: RunState.HumanClarificationNeeded }));
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No TaskBundle artifact found/);
  });

  it("loops back to HumanClarificationNeeded (not exhausted) with an incremented iteration when blockers remain and the max hasn't been reached", async () => {
    const plan = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const bundle = makeTaskBundle();
    const store: TestStore = {
      runState: RunState.HumanClarificationNeeded,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({ type: "TaskBundle", version: 1, payloadJson: bundle }),
      ],
      // Only one prior NEEDS_HUMAN_CLARIFICATION event -- well under MAX_CLARIFICATION_ITERATIONS (3).
      events: [
        { id: "e1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      ],
    };
    const { deps, plannerAgent, eventRepo } = buildDeps(store, makeRun({ state: RunState.HumanClarificationNeeded }));
    const svc = new OrchestratorService(deps as never);

    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }],
      }),
    );

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unclear" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        payloadJson: expect.objectContaining({ iteration: 2 }),
      }),
    );
  });
});

describe("OrchestratorService.runManualReReview missing Plan artifact", () => {
  it("throws when no Plan artifact exists (after recording RE_REVIEW_REQUESTED)", async () => {
    const store: TestStore = { runState: RunState.AwaitingPlanApproval, artifacts: [], events: [] };
    const { deps, runRepo } = buildDeps(store, makeRun({ state: RunState.AwaitingPlanApproval }));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.PlanReview);
  });
});

describe("OrchestratorService.runManualPlanRevision missing Plan artifact", () => {
  it("throws when no Plan artifact exists (after recording RE_REVIEW_REQUESTED)", async () => {
    const store: TestStore = { runState: RunState.AwaitingPlanApproval, artifacts: [], events: [] };
    const { deps, runRepo } = buildDeps(store, makeRun({ state: RunState.AwaitingPlanApproval }));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found/);
    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.PlanReview);
  });
});

describe("OrchestratorService maybeResearchAndReplan carries prior human answers", () => {
  it("forwards existing HumanAnswers into both the researcher call and the re-plan call", async () => {
    const priorAnswers = [{ questionId: "q1", answer: "prior human answer" }];
    const store: TestStore = {
      runState: RunState.Todo,
      artifacts: [
        asArtifact({ type: "HumanAnswers", version: 1, payloadJson: { answers: priorAnswers } }),
      ],
      events: [],
    };
    const answerResearcherAgent = { run: vi.fn() };
    const { deps, plannerAgent } = buildDeps(store, makeRun({ state: RunState.Todo, branchName: "ai/run-1" }), {
      answerResearcherAgent,
    });
    const svc = new OrchestratorService(deps as never);

    let callCount = 0;
    plannerAgent.run.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        // Initial plan: has an open question, triggering the researcher.
        return makePlan({
          planVersion: 1,
          openQuestions: [{ id: "q1", question: "Which approach?", requiredForExecution: true }],
        });
      }
      // Revised plan after research: still blocking, so we stop before plan review.
      return makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Which approach?", requiredForExecution: true }],
      });
    });
    answerResearcherAgent.run.mockResolvedValue({
      summary: "researched",
      answers: [
        { questionId: "q1", question: "Which approach?", answer: "Use approach B", confidence: "high" },
      ],
      completedAt: new Date().toISOString(),
    });

    const result = await svc.retryRun("run-1");

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { humanAnswers: priorAnswers },
    );
    expect(plannerAgent.run).toHaveBeenLastCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ humanAnswers: priorAnswers }),
    );
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.rejectPlan iterate mode carries forward prior context", () => {
  it("includes humanAnswers, researchedAnswers, and planReviewFindings from prior artifacts in the re-plan call", async () => {
    const plan = makePlan({ planVersion: 2 });
    const planReview = {
      summary: "found issues",
      findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
    };
    const humanAnswers = [{ questionId: "q1", answer: "human said yes" }];
    const researchedAnswers = [
      { questionId: "q2", question: "Q2?", answer: "researched", confidence: "high" as const },
    ];
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [
        asArtifact({ type: "Plan", version: 2, payloadJson: plan }),
        asArtifact({ type: "PlanReview", version: 1, payloadJson: planReview }),
        asArtifact({ type: "HumanAnswers", version: 1, payloadJson: { answers: humanAnswers } }),
        asArtifact({
          type: "ResearchedAnswers",
          version: 1,
          payloadJson: { summary: "s", answers: researchedAnswers, completedAt: new Date().toISOString() },
        }),
      ],
      events: [],
    };
    const { deps, plannerAgent } = buildDeps(store, makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));
    const svc = new OrchestratorService(deps as never);

    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 3,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      }),
    );

    await svc.rejectPlan("run-1", undefined, "api", "iterate");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planReviewFindings: planReview,
        humanAnswers,
        researchedAnswers,
      }),
    );
  });
});
