import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord, RejectionContextPayload } from "../../src/domain/types.js";
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
    summary: "Implementation done.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "All green.",
    ...overrides,
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
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildDeps(store: TestStore, overrides: Record<string, unknown> = {}) {
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
    create: vi.fn().mockImplementation((params: { runId: string; type: string; version: number; payloadJson: unknown }) => {
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
      const evt: RunEventRecord = {
        id: `event-${store.events.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
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
      constraints: { requiredChecks: [], maxFilesChanged: 20, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };

  let nextPlan: Plan = makePlan({ planVersion: (store.run.planVersion ?? 1) + 1 });
  const plannerAgent = {
    run: vi.fn().mockImplementation(async () => {
      await artifactRepo.create({
        runId: store.run.id,
        type: "Plan",
        version: nextPlan.planVersion,
        payloadJson: nextPlan,
      });
      return nextPlan;
    }),
    setNextPlan: (plan: Plan) => {
      nextPlan = plan;
    },
  };
  const planReviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const review = { reviewId: "prv-1", summary: "ok", findings: [], overallVerdict: "approved" as const };
      await artifactRepo.create({ runId: store.run.id, type: "PlanReview", version: 1, payloadJson: review });
      return review;
    }),
  };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const review = { reviewId: "rev-1", summary: "ok", findings: [], overallVerdict: "approved" as const };
      await artifactRepo.create({ runId: store.run.id, type: "Review", version: 1, payloadJson: review });
      return review;
    }),
  };
  const remediationAgent = { run: vi.fn() };
  const answerResearcherAgent = {
    run: vi.fn().mockResolvedValue({
      summary: "Researched.",
      answers: [{ questionId: "q1", question: "Q?", answer: "A", confidence: "high" }],
      completedAt: new Date().toISOString(),
    }),
  };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/worktree"),
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
      answerResearcherAgent,
      logger,
      dashboardEmitter,
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    plannerAgent,
    planReviewerAgent,
    answerResearcherAgent,
    executorAgent,
    linearClient,
    logger,
  };
}

describe("OrchestratorService.rejectPlan -- additional branches", () => {
  it("pauses for human clarification when the re-plan after rejection still has blocking questions", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }),
      artifacts: [],
      events: [],
    };
    const built = buildDeps(store);
    built.plannerAgent.setNextPlan(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.rejectPlan("run-1", "feedback", "api");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const eventTypes = built.eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
    const clarEvent = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION,
    )?.[0] as { payloadJson: { blockingQuestions: { id: string }[] } };
    expect(clarEvent.payloadJson.blockingQuestions).toEqual([{ id: "q1", question: "Blocking?" }]);
  });

  it("in 'fresh' mode, does not inject previousPlan/humanAnswers/researchedAnswers/planReviewFindings even if prior artifacts exist", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
        asArtifact({
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
        }),
      ],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.rejectPlan("run-1", "start over", "api", "fresh");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({
        previousPlan: expect.anything(),
        humanAnswers: expect.anything(),
        researchedAnswers: expect.anything(),
        planReviewFindings: expect.anything(),
      }),
    );
  });

  it("in 'iterate' mode (default), injects previousPlan, humanAnswers, researchedAnswers, and planReviewFindings from prior artifacts", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
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
            answers: [{ questionId: "q2", question: "Q2?", answer: "A2", confidence: "high" }],
            completedAt: new Date().toISOString(),
          },
        }),
        asArtifact({
          type: "PlanReview",
          version: 1,
          payloadJson: {
            reviewId: "prv-0",
            summary: "prior plan review summary",
            findings: [{ id: "pf1", severity: "important", type: "gap", title: "Gap", details: "explain" }],
            overallVerdict: "changes_requested",
          },
        }),
      ],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.rejectPlan("run-1", "feedback", "api", "iterate");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        previousPlan: expect.objectContaining({ planVersion: 1 }),
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [expect.objectContaining({ questionId: "q2" })],
        planReviewFindings: {
          summary: "prior plan review summary",
          findings: [expect.objectContaining({ id: "pf1" })],
        },
      }),
    );
  });
});

describe("OrchestratorService.answerQuestions -- additional error and loop branches", () => {
  it("throws when there is no Plan artifact for the run", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.HumanClarificationNeeded }),
      artifacts: [],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }])).rejects.toThrow(
      /No plan artifact found/,
    );
  });

  it("throws when there is no TaskBundle artifact for the run (after transitioning to Planning)", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.HumanClarificationNeeded }),
      artifacts: [
        asArtifact({
          type: "Plan",
          version: 1,
          payloadJson: makePlan({ openQuestions: [{ id: "q1", question: "Req?", requiredForExecution: true }] }),
        }),
      ],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }])).rejects.toThrow(
      /No TaskBundle artifact found/,
    );
  });

  it("loops back to HumanClarificationNeeded (not Failed) when blockers remain and the iteration count is under the max", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 }),
      artifacts: [
        asArtifact({
          type: "Plan",
          version: 1,
          payloadJson: makePlan({ openQuestions: [{ id: "q1", question: "Req?", requiredForExecution: true }] }),
        }),
        asArtifact({
          type: "TaskBundle",
          version: 1,
          payloadJson: {
            issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
            repo: { name: "test-repo", defaultBranch: "main", workingBranch: "ai/lin-1", repoPath: "/tmp", allowedPaths: [], protectedPaths: [] },
            constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
            definitionOfDone: [],
          },
        }),
      ],
      // One prior clarification round already happened (below MAX_CLARIFICATION_ITERATIONS = 3).
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
    const built = buildDeps(store);
    built.plannerAgent.setNextPlan(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "partial answer" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const clarEvents = built.eventRepo.create.mock.calls.filter(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION,
    );
    expect(clarEvents).toHaveLength(1);
    expect((clarEvents[0][0] as { payloadJson: { iteration: number } }).payloadJson.iteration).toBe(2);
  });
});

describe("OrchestratorService.maybeResearchAndReplan -- prior HumanAnswers branch", () => {
  it("forwards prior HumanAnswers to both the researcher and the re-plan call", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.Todo, planVersion: 1 }),
      artifacts: [
        asArtifact({
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q1", answer: "already answered" }] },
        }),
      ],
      events: [],
    };
    const built = buildDeps(store);
    built.plannerAgent.setNextPlan(
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Optional?", requiredForExecution: false }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    await svc.retryRun("run-1");

    expect(built.answerResearcherAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { humanAnswers: [{ questionId: "q1", answer: "already answered" }] },
    );

    // The re-plan call after research should also carry the human answers forward.
    const rePlanCall = built.plannerAgent.run.mock.calls.find((c: unknown[]) => {
      const opts = c[2] as { previousPlan?: unknown } | undefined;
      return !!opts?.previousPlan;
    });
    expect(rePlanCall?.[2]).toMatchObject({
      humanAnswers: [{ questionId: "q1", answer: "already answered" }],
    });
  });
});

describe("OrchestratorService.runExecution -- operator note and comment formatting branches", () => {
  function baseStore(): TestStore {
    return {
      run: makeRun({ state: RunState.Implementing, branchName: null, approvedPlanVersion: 1 }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })],
      events: [],
    };
  }

  // The real ExecutorAgent persists its ExecutionReport artifact itself; mirror
  // that here so downstream policy checks (assertCanReview / assertCanMarkReady)
  // see it.
  function stubExecutor(
    built: ReturnType<typeof buildDeps>,
    report: ExecutionReport,
    prNumber = 7,
  ): void {
    built.executorAgent.run.mockImplementation(async () => {
      await built.artifactRepo.create({
        runId: "run-1",
        type: "ExecutionReport",
        version: report.executionVersion,
        payloadJson: report,
      });
      return { report, prNumber };
    });
  }

  it("passes the operator note through to the executor agent when provided", async () => {
    const store = baseStore();
    const built = buildDeps(store);
    stubExecutor(built, makeExecutionReport());
    const svc = new OrchestratorService(built.deps as never);

    await svc.runExecution("run-1", { note: "focus on the auth module" });

    expect(built.executorAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      expect.anything(),
      { operatorNote: "focus on the auth module" },
    );
  });

  it("omits the Files changed section when no files were changed", async () => {
    const store = baseStore();
    const built = buildDeps(store);
    stubExecutor(built, makeExecutionReport({ filesChanged: [] }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.runExecution("run-1");

    const comment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    )?.[1] as string;
    expect(comment).not.toContain("Files changed");
  });

  it("collapses the file list into a <details> block when more than 8 files changed", async () => {
    const store = baseStore();
    const built = buildDeps(store);
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    stubExecutor(built, makeExecutionReport({ filesChanged: manyFiles }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.runExecution("run-1");

    const comment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    )?.[1] as string;
    expect(comment).toContain("<details>");
    expect(comment).toContain("Files changed (9)");
  });

  it("includes a Notes section when the execution report has notes", async () => {
    const store = baseStore();
    const built = buildDeps(store);
    stubExecutor(built, makeExecutionReport({ notes: ["Watch out for flaky test X"] }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.runExecution("run-1");

    const comment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    )?.[1] as string;
    expect(comment).toContain("### Notes");
    expect(comment).toContain("Watch out for flaky test X");
  });
});

describe("OrchestratorService -- updateSkillMetrics failure branch (Failed terminal state)", () => {
  it("calls incrementFailure (not incrementSuccess) for injected skills when the run ends in Failed", async () => {
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockResolvedValue({ id: "skill-1", successCount: 0, failureCount: 1, utilityScore: 0.1 }),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };

    const store: TestStore = {
      run: makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 }),
      artifacts: [
        asArtifact({
          type: "Plan",
          version: 1,
          payloadJson: makePlan({ openQuestions: [{ id: "q1", question: "Req?", requiredForExecution: true }] }),
        }),
        asArtifact({
          type: "TaskBundle",
          version: 1,
          payloadJson: {
            issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
            repo: { name: "test-repo", defaultBranch: "main", workingBranch: "ai/lin-1", repoPath: "/tmp", allowedPaths: [], protectedPaths: [] },
            constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
            definitionOfDone: [],
          },
        }),
      ],
      events: [
        { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["skill-1"] }, createdAt: new Date() },
        { id: "e2", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
        { id: "e3", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
        { id: "e4", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      ],
    };
    const built = buildDeps(store, { agentSkillRepo });
    built.plannerAgent.setNextPlan(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still confused" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });
});
