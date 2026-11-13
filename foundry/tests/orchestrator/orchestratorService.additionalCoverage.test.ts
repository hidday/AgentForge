import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
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

interface TestStore {
  runState: RunState;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function asArtifact(params: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${params.type}-${params.version}`,
    runId: "run-1",
    type: params.type as Artifact["type"],
    version: params.version,
    payloadJson: params.payloadJson,
    rawText: JSON.stringify(params.payloadJson),
    createdAt: new Date(),
  };
}

function buildDeps(store: TestStore, initialRun: Run, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi
      .fn()
      .mockImplementation((id: string) => Promise.resolve({ ...initialRun, id, state: store.runState })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, params: Record<string, unknown>) => {
      Object.assign(initialRun, params);
      return Promise.resolve({ ...initialRun, ...params, state: store.runState });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: { type: string; version: number; payloadJson: unknown }) => {
      const a = asArtifact(params);
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

  const eventRepo = {
    create: vi.fn().mockImplementation((params: { eventType: string; source: string; payloadJson?: unknown }) => {
      const e: RunEventRecord = {
        id: `event-${store.events.length}`,
        runId: "run-1",
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
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
      project: "test-project",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn(),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoEntry = {
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
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(repoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/test-repo"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(repoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(repoEntry),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };

  const plannerAgent = {
    run: vi.fn().mockImplementation(async (_bundle: unknown, _runId: string, opts?: { planVersionOverride?: number }) => {
      const plan = makePlan(opts?.planVersionOverride ? { planVersion: opts.planVersionOverride } : {});
      await artifactRepo.create({
        runId: "run-1",
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
        rawText: "{}",
      });
      return plan;
    }),
  };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "Looks good",
      findings: [],
    }),
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
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    planReviewerAgent,
  };
}

describe("OrchestratorService.rejectPlan -- iterate-mode context injection and post-reject blocking", () => {
  it("injects humanAnswers, researchedAnswers, and planReviewFindings from loadReplanContext in iterate mode", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
        }),
        asArtifact({
          type: "ResearchedAnswers",
          version: 1,
          payloadJson: {
            summary: "r",
            completedAt: new Date().toISOString(),
            answers: [{ questionId: "q2", question: "?", answer: "y", confidence: "medium" }],
          },
        }),
        asArtifact({
          type: "PlanReview",
          version: 1,
          payloadJson: { summary: "needs polish", findings: [] },
        }),
      ],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await svc.rejectPlan("run-1", "iterate please", "api", "iterate");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q2", question: "?", answer: "y", confidence: "medium" }],
        planReviewFindings: { summary: "needs polish", findings: [] },
      }),
    );
  });

  it("pauses for human clarification when the post-rejection re-plan still has blocking questions", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const built = buildDeps(store, initialRun);
    built.plannerAgent.run.mockImplementation(async () => {
      const plan = makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      });
      await built.artifactRepo.create({
        runId: "run-1",
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
        rawText: "{}",
      });
      return plan;
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.rejectPlan("run-1", "still unclear");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.answerQuestions -- missing-artifact guards and re-blocked iteration", () => {
  it("throws when there is no Plan artifact for the run", async () => {
    const store: TestStore = { runState: RunState.HumanClarificationNeeded, artifacts: [], events: [] };
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No plan artifact found/);
  });

  it("throws when there is no TaskBundle artifact after CLARIFICATION_PROVIDED", async () => {
    const store: TestStore = {
      runState: RunState.HumanClarificationNeeded,
      artifacts: [
        asArtifact({
          type: "Plan",
          version: 1,
          payloadJson: makePlan({
            openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
          }),
        }),
      ],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No TaskBundle artifact found/);
  });

  it("re-enters HumanClarificationNeeded (with incremented iteration) when blockers remain and max iterations is not yet reached", async () => {
    const store: TestStore = {
      runState: RunState.HumanClarificationNeeded,
      artifacts: [
        asArtifact({
          type: "Plan",
          version: 1,
          payloadJson: makePlan({
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
              workingBranch: "ai/lin-1",
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
      ],
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
          source: "planner-agent",
          payloadJson: {},
          createdAt: new Date(),
        },
      ],
    };
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const built = buildDeps(store, initialRun);
    built.plannerAgent.run.mockImplementation(async () => {
      const plan = makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q2", question: "Still blocking?", requiredForExecution: true }],
      });
      await built.artifactRepo.create({
        runId: "run-1",
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
        rawText: "{}",
      });
      return plan;
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const reBlockEvent = store.events.find(
      (e) => e.eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION && e !== store.events[0],
    );
    expect(reBlockEvent).toBeDefined();
    expect((reBlockEvent!.payloadJson as { iteration: number }).iteration).toBe(2);
  });
});

describe("OrchestratorService.runManualReReview / runManualPlanRevision -- missing-plan guard", () => {
  it("runManualReReview throws when there is no Plan artifact", async () => {
    const store: TestStore = { runState: RunState.AwaitingPlanApproval, artifacts: [], events: [] };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("runManualPlanRevision throws when there is no Plan artifact", async () => {
    const store: TestStore = { runState: RunState.AwaitingPlanApproval, artifacts: [], events: [] };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService -- answer researcher receives prior human answers", () => {
  it("passes existing HumanAnswers into both the researcher call and the re-plan call", async () => {
    const store: TestStore = {
      runState: RunState.Todo,
      artifacts: [
        asArtifact({
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q1", answer: "pre-existing answer" }] },
        }),
      ],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Todo, branchName: "ai/existing" });

    // The first plannerAgent.run call (from retryRun) returns a plan WITH open
    // questions so maybeResearchAndReplan actually triggers the researcher.
    let plannerCallCount = 0;
    const answerResearcherAgent = {
      run: vi.fn().mockResolvedValue({
        summary: "researched",
        completedAt: new Date().toISOString(),
        answers: [{ questionId: "q1", question: "?", answer: "ok", confidence: "high" as const }],
      }),
    };

    const built = buildDeps(store, initialRun, { answerResearcherAgent });
    built.plannerAgent.run.mockImplementation(async (_bundle: unknown, _runId: string, opts?: { planVersionOverride?: number }) => {
      plannerCallCount += 1;
      const plan =
        plannerCallCount === 1
          ? makePlan({
              planVersion: opts?.planVersionOverride ?? 1,
              openQuestions: [{ id: "q1", question: "Needs info?", requiredForExecution: false }],
            })
          : makePlan({ planVersion: opts?.planVersionOverride ?? 2, openQuestions: [] });
      await built.artifactRepo.create({
        runId: "run-1",
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
        rawText: "{}",
      });
      return plan;
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.retryRun("run-1");

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { humanAnswers: [{ questionId: "q1", answer: "pre-existing answer" }] },
    );

    // Second plannerAgent.run call (the re-plan after research) also receives humanAnswers
    expect(built.plannerAgent.run).toHaveBeenLastCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanAnswers: [{ questionId: "q1", answer: "pre-existing answer" }],
        researchedAnswers: [{ questionId: "q1", question: "?", answer: "ok", confidence: "high" }],
      }),
    );

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});
