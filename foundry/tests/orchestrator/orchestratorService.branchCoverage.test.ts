import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: "Some description",
    linearIssueTitle: "Fix the bug",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: 42,
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Clean implementation.",
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
    planReviewerAgent,
    planReviserAgent,
    executorAgent,
    reviewerAgent,
    githubClient,
    linearClient,
    logger,
  };
}

describe("OrchestratorService.requireRun", () => {
  it("throws a descriptive error when the run does not exist", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
    const { deps, runRepo } = buildDeps(store, makeRun());
    runRepo.findById.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanning("missing-run")).rejects.toThrow(/Run not found: missing-run/);
  });
});

describe("OrchestratorService.rejectPlan fresh mode", () => {
  it("does not carry forward previousPlan/humanAnswers/researchedAnswers/planReviewFindings in fresh mode", async () => {
    const plan = makePlan({ planVersion: 2 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [
        asArtifact({ type: "Plan", version: 2, payloadJson: plan }),
        asArtifact({ type: "HumanAnswers", version: 1, payloadJson: { answers: [{ questionId: "q1", answer: "x" }] } }),
        asArtifact({
          type: "PlanReview",
          version: 1,
          payloadJson: { summary: "s", findings: [{ id: "f1", severity: "important", title: "t", details: "d" }] },
        }),
      ],
      events: [],
    };
    const { deps, plannerAgent } = buildDeps(store, makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));
    const svc = new OrchestratorService(deps as never);

    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 3, openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }] }),
    );

    await svc.rejectPlan("run-1", "start over", "api", "fresh");

    const callArgs = plannerAgent.run.mock.calls[0][2] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("previousPlan");
    expect(callArgs).not.toHaveProperty("humanAnswers");
    expect(callArgs).not.toHaveProperty("researchedAnswers");
    expect(callArgs).not.toHaveProperty("planReviewFindings");
  });
});

describe("OrchestratorService.runExecution additional branches", () => {
  it("does not recover and re-runs the executor when EXECUTION_FINISHED was already recorded after the report", async () => {
    const plan = makePlan({ planVersion: 1 });
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const reportCreatedAt = new Date("2026-01-01T00:05:00Z");
    const finishedAt = new Date("2026-01-01T00:10:00Z"); // after report -- already finished, no recovery needed
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        { ...asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }), createdAt: reportCreatedAt },
      ],
      events: [
        { id: "e1", runId: "run-1", eventType: RunEvent.EXECUTION_STARTED, source: "orchestrator", payloadJson: {}, createdAt: startedAt },
        { id: "e2", runId: "run-1", eventType: RunEvent.EXECUTION_FINISHED, source: "executor-agent", payloadJson: {}, createdAt: finishedAt },
      ],
    };
    const initialRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, prNumber: 77 });
    const { deps, executorAgent } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    executorAgent.run.mockResolvedValue({ report: makeExecutionReport({ executionVersion: 2 }), prNumber: 77 });

    await svc.runExecution("run-1");

    // Since EXECUTION_FINISHED was already recorded after the stale report, the
    // recovery shortcut must NOT trigger -- the executor runs normally instead.
    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("forwards opts.note as an operatorNote to the executor agent", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    const { deps, executorAgent } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 1 });

    await svc.runExecution("run-1", { note: "focus on error handling" });

    expect(executorAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      expect.anything(),
      { operatorNote: "focus on error handling" },
    );
  });
});

describe("OrchestratorService.runManualPlanRevision without an operator note", () => {
  it("passes undefined (not an object) to runPlanRevision when no note is given", async () => {
    const plan = makePlan();
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps, planReviewerAgent, planReviserAgent } = buildDeps(store, makeRun({ state: RunState.AwaitingPlanApproval }));
    const svc = new OrchestratorService(deps as never);

    planReviewerAgent.run.mockResolvedValue({
      overallVerdict: "changes_requested",
      summary: "needs work",
      findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision");
    await svc.runManualPlanRevision("run-1");

    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1", undefined);
  });
});

describe("OrchestratorService.approveHumanReview non-Error distillation failure", () => {
  it("stringifies a thrown non-Error value in the warning log", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [], events: [] };
    const distillationAgent = { run: vi.fn().mockRejectedValue("plain string failure") };
    const { deps, logger } = buildDeps(store, makeRun({ state: RunState.ReadyForHumanReview }), {
      distillationAgent,
    });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "plain string failure" }),
      expect.stringContaining("Distillation agent failed"),
    );
  });
});

describe("OrchestratorService.buildTaskBundle non-Error failures", () => {
  it("stringifies a non-Error thrown by githubClient.getDefaultBranch", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
    const initialRun = makeRun({ state: RunState.Todo });
    const { deps, plannerAgent, githubClient, logger } = buildDeps(store, initialRun);
    (githubClient as unknown as { getDefaultBranch: ReturnType<typeof vi.fn> }).getDefaultBranch = vi
      .fn()
      .mockRejectedValue("network exploded");
    const svc = new OrchestratorService(deps as never);

    plannerAgent.run.mockResolvedValue(
      makePlan({ openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }] }),
    );

    await svc.retryRun("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "network exploded" }),
      expect.stringContaining("Failed to resolve default branch"),
    );
  });

  it("stringifies a non-Error thrown by linearClient.getRelatedContext", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
    const initialRun = makeRun({ state: RunState.Todo });
    const { deps, plannerAgent, linearClient, logger } = buildDeps(store, initialRun);
    (linearClient as unknown as { getRelatedContext: ReturnType<typeof vi.fn> }).getRelatedContext = vi
      .fn()
      .mockRejectedValue("linear exploded");
    const svc = new OrchestratorService(deps as never);

    plannerAgent.run.mockResolvedValue(
      makePlan({ openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }] }),
    );

    await svc.retryRun("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "linear exploded" }),
      expect.stringContaining("Failed to fetch related Linear context"),
    );
  });
});

describe("OrchestratorService.runReview with no Plan artifact yet", () => {
  it("still runs the reviewer with an undefined plan rather than throwing", async () => {
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() })],
      events: [],
    };
    const { deps, reviewerAgent } = buildDeps(store, makeRun({ state: RunState.AIReview, prNumber: 42 }));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    reviewerAgent.run.mockResolvedValue({
      reviewId: "r1",
      summary: "fine",
      findings: [],
      overallVerdict: "approved",
    } satisfies Review);

    await svc.runReview("run-1");

    expect(reviewerAgent.run).toHaveBeenCalledWith(
      undefined,
      expect.anything(),
      "diff content",
      expect.anything(),
      "run-1",
    );
  });
});

describe("OrchestratorService comment formatting -- less common fields", () => {
  it("includes a Risks section in the plan comment when the plan has risks", async () => {
    const plan = makePlan({ planVersion: 1, risks: ["Data migration could be lossy"] });
    const store: TestStore = {
      runState: RunState.PlanReview,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps, plannerAgent: _p, linearClient } = buildDeps(store, makeRun({ state: RunState.PlanReview }));
    (deps as unknown as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }).planReviewerAgent.run.mockResolvedValue(
      { overallVerdict: "approved", summary: "Fine", findings: [] },
    );
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanReview("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Data migration could be lossy"),
    );
  });

  it("renders the fail and skip check icons in the execution report comment", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    const { deps, executorAgent, linearClient } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "2 errors" },
          typecheck: { status: "skip", details: "not run" },
          tests: { status: "pass", details: "ok" },
        },
      }),
      prNumber: 1,
    });

    await svc.runExecution("run-1");

    const call = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(call?.[1]).toContain(":x:");
    expect(call?.[1]).toContain(":heavy_minus_sign:");
  });

  it("includes the affected step id in a plan review finding and the line hint in a code review finding", async () => {
    // Plan review finding with affectedStepId, via the changes_requested path.
    const plan = makePlan({ planVersion: 1 });
    const reviewStore: TestStore = {
      runState: RunState.PlanReview,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps: reviewDeps, linearClient: reviewLinearClient } = buildDeps(
      reviewStore,
      makeRun({ state: RunState.PlanReview }),
    );
    (reviewDeps as unknown as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }).planReviewerAgent.run.mockResolvedValue(
      {
        overallVerdict: "changes_requested",
        summary: "needs work",
        findings: [{ id: "f1", severity: "important", title: "Step issue", details: "d", affectedStepId: "s1" }],
      },
    );
    (reviewDeps as unknown as { planReviserAgent: { run: ReturnType<typeof vi.fn> } }).planReviserAgent.run.mockResolvedValue(
      { revision: { dispositions: [] }, revisedPlan: makePlan({ planVersion: 2 }) },
    );
    const reviewSvc = new OrchestratorService(reviewDeps as never);
    await reviewSvc.runPlanReview("run-1");

    const planReviewCall = reviewLinearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Step issue"),
    );
    expect(planReviewCall?.[1]).toContain("(step s1)");

    // Code review finding with lineHint, via runReview's changes_requested path.
    const codeStore: TestStore = {
      runState: RunState.AIReview,
      artifacts: [asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() })],
      events: [],
    };
    const { deps: codeDeps, reviewerAgent, linearClient: codeLinearClient } = buildDeps(
      codeStore,
      makeRun({ state: RunState.AIReview, prNumber: 42 }),
    );
    const codeSvc = new OrchestratorService(codeDeps as never);
    vi.spyOn(codeSvc, "runRemediation").mockResolvedValue(makeRun({ state: RunState.AddressingReview }));
    reviewerAgent.run.mockResolvedValue({
      reviewId: "r1",
      summary: "found a bug",
      findings: [
        { id: "f1", severity: "important", type: "bug", file: "src/foo.ts", lineHint: 42, title: "Bug", details: "d" },
      ],
      overallVerdict: "changes_requested",
    } satisfies Review);

    await codeSvc.runReview("run-1");

    const codeReviewCall = codeLinearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Bug"),
    );
    expect(codeReviewCall?.[1]).toContain("src/foo.ts:42");
  });
});

describe("OrchestratorService.retrieveSkillsForPlanning with missing run text fields", () => {
  it("builds the relevance query safely when linearIssueTitle and linearIssueDescription are null", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
    const initialRun = makeRun({ state: RunState.Todo, linearIssueTitle: null, linearIssueDescription: null });
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, plannerAgent } = buildDeps(store, initialRun, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    plannerAgent.run.mockImplementation(async () => {
      const plan = makePlan({ planVersion: 1 });
      store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: plan }));
      return plan;
    });
    (deps as unknown as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }).planReviewerAgent.run.mockResolvedValue(
      { overallVerdict: "approved", summary: "OK", findings: [] },
    );

    await svc.retryRun("run-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith("test-repo", " ", expect.any(Number));
  });
});

describe("OrchestratorService.updateSkillMetrics defensive branches", () => {
  it("treats a SKILL_INJECTION event with no skillIds as contributing zero ids", async () => {
    const store: TestStore = {
      runState: RunState.ReadyForHumanReview,
      artifacts: [],
      events: [
        { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: {}, createdAt: new Date() },
      ],
    };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps } = buildDeps(store, makeRun({ state: RunState.ReadyForHumanReview }), { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("stringifies a non-Error rejection from incrementSuccess in the warning log", async () => {
    const store: TestStore = {
      runState: RunState.ReadyForHumanReview,
      artifacts: [],
      events: [
        { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["skill-x"] }, createdAt: new Date() },
      ],
    };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockRejectedValue("plain rejection"),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, logger } = buildDeps(store, makeRun({ state: RunState.ReadyForHumanReview }), { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ skillId: "skill-x", error: "plain rejection" }),
      expect.stringContaining("Failed to update skill metric"),
    );
  });
});

describe("OrchestratorService.answerQuestions preserves prior ResearchedAnswers on re-plan", () => {
  it("includes researchedAnswers from an existing ResearchedAnswers artifact in the re-plan call", async () => {
    const plan = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const bundle = {
      issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/run-1",
        repoPath: "/tmp/worktree",
        allowedPaths: ["src/"],
        protectedPaths: [],
      },
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
      definitionOfDone: [],
    };
    const researchedAnswers = [
      { questionId: "q2", question: "Q2?", answer: "researched", confidence: "high" as const },
    ];
    const store: TestStore = {
      runState: RunState.HumanClarificationNeeded,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({ type: "TaskBundle", version: 1, payloadJson: bundle }),
        asArtifact({
          type: "ResearchedAnswers",
          version: 1,
          payloadJson: { summary: "s", answers: researchedAnswers, completedAt: new Date().toISOString() },
        }),
      ],
      events: [],
    };
    const { deps, plannerAgent } = buildDeps(store, makeRun({ state: RunState.HumanClarificationNeeded }));
    const svc = new OrchestratorService(deps as never);

    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
    (deps as unknown as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }).planReviewerAgent.run.mockResolvedValue(
      { overallVerdict: "approved", summary: "OK", findings: [] },
    );

    await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    expect(plannerAgent.run).toHaveBeenCalledWith(
      bundle,
      "run-1",
      expect.objectContaining({ researchedAnswers }),
    );
  });
});
