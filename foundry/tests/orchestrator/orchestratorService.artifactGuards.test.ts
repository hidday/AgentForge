import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

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
    workingDirectory: "/tmp/worktree",
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Green.",
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> & { type: Artifact["type"] }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version ?? 1}`,
    runId: "run-1",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

interface TestStore {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildDeps(store: TestStore, agentSkillRepoOverrides?: Record<string, unknown>) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.run = { ...store.run, state: newState };
      return Promise.resolve({ ...store.run });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      store.run = { ...store.run, ...patch };
      return Promise.resolve({ ...store.run });
    }),
  };

  const artifactRepo = {
    create: vi
      .fn()
      .mockImplementation((params: { type: string; version: number; payloadJson: unknown }) => {
        const a = makeArtifact({
          type: params.type as Artifact["type"],
          version: params.version,
          payloadJson: params.payloadJson,
        });
        store.artifacts.push(a);
        return Promise.resolve(a);
      }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      return Promise.resolve(
        matching.reduce((best, cur) => (cur.version > best.version ? cur : best)),
      );
    }),
  };

  let eventSeq = 0;
  const eventRepo = {
    create: vi
      .fn()
      .mockImplementation(
        (params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
          eventSeq += 1;
          const rec: RunEventRecord = {
            id: `event-${eventSeq}`,
            runId: params.runId,
            eventType: params.eventType,
            source: params.source,
            payloadJson: params.payloadJson,
            createdAt: new Date(),
          };
          store.events.push(rec);
          return Promise.resolve(rec);
        },
      ),
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
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn(),
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

  const agentSkillRepo = agentSkillRepoOverrides
    ? {
        findTopKByRelevance: vi.fn().mockResolvedValue([]),
        incrementSuccess: vi.fn(),
        incrementFailure: vi.fn(),
        archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
        ...agentSkillRepoOverrides,
      }
    : undefined;

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
      ...(agentSkillRepo ? { agentSkillRepo } : {}),
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    executorAgent,
  };
}

describe("OrchestratorService.approvePlan -- edge cases", () => {
  it("throws when there is no Plan artifact", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("includes the operator note in the approval comment when provided", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const { deps, linearClient } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await svc.approvePlan("run-1", { note: "go ahead" });

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("approved with operator note"),
    );
    expect(linearClient.postComment).toHaveBeenCalledWith("LIN-1", expect.stringContaining("go ahead"));
  });
});

describe("OrchestratorService.answerQuestions -- artifact guards", () => {
  it("throws when there is no Plan artifact", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.HumanClarificationNeeded }),
      artifacts: [],
      events: [],
    };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No plan artifact found/);
  });

  it("throws when there is no TaskBundle artifact after CLARIFICATION_PROVIDED", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.HumanClarificationNeeded }),
      artifacts: [
        makeArtifact({
          type: "Plan",
          version: 1,
          payloadJson: makePlan({
            openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
          }),
        }),
        // Deliberately no TaskBundle artifact.
      ],
      events: [],
    };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No TaskBundle artifact found/);
  });

  it("loops back to HumanClarificationNeeded (not exhausted) when blockers remain after re-planning", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.HumanClarificationNeeded }),
      artifacts: [
        makeArtifact({
          type: "Plan",
          version: 1,
          payloadJson: makePlan({
            openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
          }),
        }),
        makeArtifact({
          type: "TaskBundle",
          version: 1,
          payloadJson: {
            issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
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
      ],
      // Only 1 prior NEEDS_HUMAN_CLARIFICATION event -- below MAX_CLARIFICATION_ITERATIONS (3).
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
    const { deps, plannerAgent } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q2", question: "Still unclear?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const loopEvent = (deps.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) =>
        (c[0] as { eventType: string }).eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION &&
        (c[0] as { payloadJson: { iteration?: number } }).payloadJson?.iteration === 2,
    );
    expect(loopEvent).toBeDefined();
  });
});

describe("OrchestratorService.runManualReReview / runManualPlanRevision -- artifact guards", () => {
  it("runManualReReview throws when there is no Plan artifact", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.AwaitingPlanApproval }),
      artifacts: [],
      events: [],
    };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("runManualPlanRevision throws when there is no Plan artifact", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.AwaitingPlanApproval }),
      artifacts: [],
      events: [],
    };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService -- updateSkillMetrics failure branch", () => {
  it("calls incrementFailure (not incrementSuccess) when the run ends in Failed", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.HumanClarificationNeeded }),
      artifacts: [
        makeArtifact({
          type: "Plan",
          version: 1,
          payloadJson: makePlan({
            openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
          }),
        }),
        makeArtifact({
          type: "TaskBundle",
          version: 1,
          payloadJson: {
            issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
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
      ],
      // 3 prior NEEDS_HUMAN_CLARIFICATION events -- meets MAX_CLARIFICATION_ITERATIONS.
      events: [
        { id: "e1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
        { id: "e2", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
        { id: "e3", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
        // Also record a SKILL_INJECTION so updateSkillMetrics has something to act on.
        { id: "e4", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["skill-x"] }, createdAt: new Date() },
      ],
    };
    const incrementFailure = vi.fn().mockResolvedValue({ id: "skill-x" });
    const incrementSuccess = vi.fn();
    const { deps, plannerAgent } = buildDeps(store, { incrementFailure, incrementSuccess });
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q2", question: "Still unclear?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(incrementFailure).toHaveBeenCalledWith("skill-x");
    expect(incrementSuccess).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.rejectPlan -- iterate mode with full prior context", () => {
  it("forwards prior humanAnswers, researchedAnswers and planReviewFindings from loadReplanContext", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }),
      artifacts: [
        makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        makeArtifact({
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
        }),
        makeArtifact({
          type: "ResearchedAnswers",
          version: 1,
          payloadJson: {
            summary: "s",
            answers: [{ questionId: "q2", question: "Q2?", answer: "A2", confidence: "medium" }],
            completedAt: new Date().toISOString(),
          },
        }),
        makeArtifact({
          type: "PlanReview",
          version: 1,
          payloadJson: { summary: "prior review", findings: [] },
        }),
      ],
      events: [],
    };
    const { deps, plannerAgent } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
    (deps.planReviewerAgent.run as ReturnType<typeof vi.fn>).mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });
    const svc = new OrchestratorService(deps as never);

    await svc.rejectPlan("run-1", undefined, "api", "iterate");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q2", question: "Q2?", answer: "A2", confidence: "medium" }],
        planReviewFindings: { summary: "prior review", findings: [] },
      }),
    );
  });
});

describe("OrchestratorService -- formatExecutionReportComment with no files changed", () => {
  it("omits the Files changed section entirely when filesChanged is empty", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 }),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const { deps, executorAgent, linearClient } = buildDeps(store);
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: [] }),
      prNumber: 9,
    });
    const svc = new OrchestratorService(deps as never);

    await svc.runExecution("run-1").catch(() => undefined);

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(comment).toBeDefined();
    expect(comment![1]).not.toContain("Files changed");
  });
});
