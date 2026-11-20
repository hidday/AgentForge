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

function makeTaskBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "Test issue", description: "Test description", labels: [], priority: 0 },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/run-1",
      repoPath: "/tmp",
      allowedPaths: ["src/"],
      protectedPaths: [],
    },
    constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    definitionOfDone: [],
  };
}

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown; id?: string }): Artifact {
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
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildDeps(store: TestStore, initialRun: Run, extraDeps: Record<string, unknown> = {}) {
  const run: Run = { ...initialRun, state: store.runState };

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...run, state: store.runState })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      run.state = newState;
      return Promise.resolve({ ...run, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      Object.assign(run, patch);
      return Promise.resolve({ ...run, state: store.runState });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; type: string; version: number; payloadJson: unknown; rawText: string }) => {
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
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const e: RunEventRecord = {
        id: `event-${store.events.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson,
        createdAt: new Date(),
      };
      store.events.push(e);
      return Promise.resolve(e);
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
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  function setPlannerPlan(plan: Plan): void {
    plannerAgent.run.mockImplementation(async () => {
      await artifactRepo.create({ runId: "run-1", type: "Plan", version: plan.planVersion, payloadJson: plan, rawText: "{}" });
      return plan;
    });
  }

  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({ reviewId: "pr-1", summary: "ok", findings: [], overallVerdict: "approved" }),
  };
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
      ...extraDeps,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    setPlannerPlan,
    planReviewerAgent,
  };
}

describe("OrchestratorService.rejectPlan -- blocking questions after re-plan", () => {
  it("pauses for human clarification instead of proceeding to plan review", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const { deps, setPlannerPlan, planReviewerAgent } = buildDeps(store, initialRun);
    setPlannerPlan(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }] }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.rejectPlan("run-1", "please reconsider the approach");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.answerQuestions -- missing-artifact failure paths", () => {
  it("throws when there is no Plan artifact for the run", async () => {
    const store: TestStore = { runState: RunState.HumanClarificationNeeded, artifacts: [], events: [] };
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded });
    const { deps } = buildDeps(store, initialRun);

    const svc = new OrchestratorService(deps as never);
    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No plan artifact found for run run-1/);
  });

  it("throws when there is no TaskBundle artifact for the run (HumanClarificationNeeded path)", async () => {
    const plan = makePlan({ openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }] });
    const store: TestStore = {
      runState: RunState.HumanClarificationNeeded,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded });
    const { deps } = buildDeps(store, initialRun);

    const svc = new OrchestratorService(deps as never);
    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "staging" }]),
    ).rejects.toThrow(/No TaskBundle artifact found for run run-1/);
  });
});

describe("OrchestratorService.answerQuestions -- still-blocked re-plan under the iteration cap", () => {
  it("loops back to HumanClarificationNeeded (not Failed) with the updated blocking questions", async () => {
    const plan = makePlan({ openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }] });
    const store: TestStore = {
      runState: RunState.HumanClarificationNeeded,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({ type: "TaskBundle", version: 1, payloadJson: makeTaskBundle() }),
      ],
      // Only one prior NEEDS_HUMAN_CLARIFICATION event -- well under
      // MAX_CLARIFICATION_ITERATIONS (3).
      events: [
        { id: "e1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      ],
    };
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const { deps } = buildDeps(store, initialRun);
    const stillBlockedPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q2", question: "Which region?", requiredForExecution: true }],
    });
    deps.plannerAgent.run.mockResolvedValue(stillBlockedPlan);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "staging" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const lastClarificationEvent = [...store.events]
      .reverse()
      .find((e) => e.eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION);
    expect((lastClarificationEvent?.payloadJson as { iteration?: number })?.iteration).toBe(2);
    expect(
      (lastClarificationEvent?.payloadJson as { blockingQuestions?: { id: string }[] })?.blockingQuestions,
    ).toEqual([{ id: "q2", question: "Which region?" }]);
  });
});

describe("OrchestratorService.runManualReReview -- missing Plan artifact", () => {
  it("throws before invoking the plan reviewer", async () => {
    const store: TestStore = { runState: RunState.AwaitingPlanApproval, artifacts: [], events: [] };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, planReviewerAgent } = buildDeps(store, initialRun);

    const svc = new OrchestratorService(deps as never);
    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found for run run-1/);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runManualPlanRevision -- missing Plan artifact", () => {
  it("throws before invoking the plan reviewer", async () => {
    const store: TestStore = { runState: RunState.AwaitingPlanApproval, artifacts: [], events: [] };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, planReviewerAgent } = buildDeps(store, initialRun);

    const svc = new OrchestratorService(deps as never);
    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found for run run-1/);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService -- maybeResearchAndReplan forwards prior HumanAnswers", () => {
  it("includes existing humanAnswers in both the researcher call and the re-plan call", async () => {
    const store: TestStore = {
      runState: RunState.Todo,
      artifacts: [
        asArtifact({
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q0", answer: "prior answer" }], submittedAt: "2026-01-01T00:00:00Z" },
        }),
      ],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Todo });
    const answerResearcherAgent = {
      run: vi.fn().mockResolvedValue({
        summary: "researched",
        answers: [{ questionId: "q1", question: "Which env?", answer: "staging", confidence: "high", sources: [] }],
        completedAt: "2026-01-01T00:00:00Z",
      }),
    };
    const { deps, setPlannerPlan } = buildDeps(store, initialRun, { answerResearcherAgent });
    (deps.repoRegistry.resolveForIssue as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    });
    (deps.repoRegistry.resolveWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue("/tmp");
    (deps.runRepo.findActiveByIssueId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (deps.runRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(initialRun);

    // First plannerAgent.run call returns a plan with an open question
    // (triggering the researcher); the second call is the re-plan after
    // research, which setPlannerPlan drives for every subsequent call.
    const planWithQuestion = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: false }],
    });
    // First plannerAgent.run call (the initial plan) returns a plan with an
    // open question, triggering the researcher; every subsequent call (the
    // re-plan after research) resolves via the plan-persisting implementation
    // that setPlannerPlan installs.
    deps.plannerAgent.run.mockResolvedValueOnce(planWithQuestion);
    setPlannerPlan(makePlan({ planVersion: 2, openQuestions: [] }));

    const svc = new OrchestratorService(deps as never);
    await svc.startRun("LIN-1");

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      expect.objectContaining({ humanAnswers: [{ questionId: "q0", answer: "prior answer" }] }),
    );

    // Second plannerAgent.run call (the re-plan after research) must also
    // carry the prior humanAnswers forward.
    const secondCall = deps.plannerAgent.run.mock.calls[1];
    expect(secondCall[2]).toMatchObject({ humanAnswers: [{ questionId: "q0", answer: "prior answer" }] });
  });
});
