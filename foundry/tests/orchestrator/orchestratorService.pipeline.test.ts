import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError, PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { Remediation } from "../../src/schemas/remediation.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Test issue",
    linearIssueUrl: "https://linear.app/x",
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Good implementation",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Reviewed",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeRemediation(overrides: Partial<Remediation> = {}): Remediation {
  return {
    reviewId: "rev-1",
    resolution: [
      { findingId: "f1", status: "accepted", action: "Fixed", rationale: "Real bug" },
    ],
    readyForHumanReview: true,
    executionReport: makeExecutionReport({ executionVersion: 2 }),
    ...overrides,
  };
}

function asArtifact(overrides: {
  type: string;
  version: number;
  payloadJson: unknown;
  id?: string;
  createdAt?: Date;
}): Artifact {
  return {
    id: overrides.id ?? `artifact-${overrides.type}-${overrides.version}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: overrides.createdAt ?? new Date(),
  };
}

interface StoredEvent {
  id: string;
  runId: string;
  eventType: string;
  source: string;
  payloadJson?: unknown;
  createdAt: Date;
}

interface TestStore {
  runState: RunState;
  artifacts: Artifact[];
  events: StoredEvent[];
}

function buildDeps(
  store: TestStore,
  initialRun: Run,
  opts: {
    agentSkillRepo?: {
      findTopKByRelevance: ReturnType<typeof vi.fn>;
      incrementSuccess: ReturnType<typeof vi.fn>;
      incrementFailure: ReturnType<typeof vi.fn>;
      archiveIfLowUtility: ReturnType<typeof vi.fn>;
    };
    distillationAgent?: { run: ReturnType<typeof vi.fn> } | null;
  } = {},
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
    update: vi.fn().mockImplementation((_id: string, data: Partial<Run>) => {
      Object.assign(initialRun, data);
      return Promise.resolve({ ...initialRun, state: store.runState });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    }) => {
      const a = asArtifact({
        type: params.type,
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
      const latest = matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
      return Promise.resolve(latest);
    }),
  };

  let eventCounter = 0;
  const eventRepo = {
    create: vi
      .fn()
      .mockImplementation(
        (params: { eventType: string; source: string; payloadJson?: unknown }) => {
          eventCounter += 1;
          const evt: StoredEvent = {
            id: `event-${eventCounter}`,
            runId: initialRun.id,
            eventType: params.eventType,
            source: params.source,
            payloadJson: params.payloadJson,
            createdAt: new Date(Date.now() + eventCounter),
          };
          store.events.push(evt);
          return Promise.resolve(evt);
        },
      ),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "ENG-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
      project: "test-project",
    }),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff content"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

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
    postReviewFindings: vi.fn().mockResolvedValue(new Map([["f1", 123]])),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };

  let executorResult: { report: ExecutionReport; prNumber: number } | null = {
    report: makeExecutionReport(),
    prNumber: 42,
  };
  let executorError: Error | null = null;
  const executorAgent = {
    run: vi.fn().mockImplementation(async () => {
      if (executorError) throw executorError;
      const result = executorResult!;
      await artifactRepo.create({
        runId: initialRun.id,
        type: "ExecutionReport",
        version: result.report.executionVersion,
        payloadJson: result.report,
        rawText: JSON.stringify(result.report),
      });
      return result;
    }),
  };

  let reviewToReturn: Review = makeReview();
  const reviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const review = reviewToReturn;
      await artifactRepo.create({
        runId: initialRun.id,
        type: "Review",
        version: 1,
        payloadJson: review,
        rawText: JSON.stringify(review),
      });
      return review;
    }),
  };

  let remediationToReturn: Remediation = makeRemediation();
  const remediationAgent = {
    run: vi.fn().mockImplementation(async () => {
      const remediation = remediationToReturn;
      await artifactRepo.create({
        runId: initialRun.id,
        type: "ExecutionReport",
        version: remediation.executionReport.executionVersion,
        payloadJson: remediation.executionReport,
        rawText: JSON.stringify(remediation.executionReport),
      });
      await artifactRepo.create({
        runId: initialRun.id,
        type: "Remediation",
        version: 1,
        payloadJson: remediation,
        rawText: JSON.stringify(remediation),
      });
      return remediation;
    }),
  };

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

  const deps: Record<string, unknown> = {
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
  };
  if (opts.agentSkillRepo) deps.agentSkillRepo = opts.agentSkillRepo;
  if (opts.distillationAgent) deps.distillationAgent = opts.distillationAgent;

  return {
    deps,
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    githubSync,
    gitService,
    executorAgent,
    reviewerAgent,
    remediationAgent,
    logger,
    dashboardEmitter,
    setExecutorResult: (result: { report: ExecutionReport; prNumber: number } | null) => {
      executorResult = result;
    },
    setExecutorError: (err: Error | null) => {
      executorError = err;
    },
    setReview: (review: Review) => {
      reviewToReturn = review;
    },
    setRemediation: (remediation: Remediation) => {
      remediationToReturn = remediation;
    },
  };
}

describe("OrchestratorService.runExecution", () => {
  it("happy path: executes, transitions to AIReview, then chains into an approved review and markReady", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, prNumber: null });
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store, initialRun);
    built.setExecutorResult({ report: makeExecutionReport(), prNumber: 77 });
    built.setReview(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runExecution("run-1");

    expect(built.gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(built.gitService.commitAndPush).toHaveBeenCalled();
    expect(built.executorAgent.run).toHaveBeenCalledTimes(1);
    expect(built.reviewerAgent.run).toHaveBeenCalledTimes(1);

    const eventTypes = store.events.map((e) => e.eventType);
    expect(eventTypes).toEqual([
      RunEvent.EXECUTION_STARTED,
      RunEvent.EXECUTION_FINISHED,
      RunEvent.REVIEW_APPROVED,
    ]);
    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(initialRun.prNumber).toBe(77);
    expect(initialRun.executorRuntime).toBe("claude-code");
    expect(built.linearClient.postComment).toHaveBeenCalled();
  });

  it("blocks the run and records EXECUTION_TIMEOUT when the executor agent times out", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store, initialRun);
    built.setExecutorError(new AgentTimeoutError("executor", 3_600_000));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(built.reviewerAgent.run).not.toHaveBeenCalled();
    const eventTypes = store.events.map((e) => e.eventType);
    expect(eventTypes).toContain("EXECUTION_TIMEOUT");
    expect(eventTypes).toContain(RunEvent.BLOCKED);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("timed out"),
    );
  });

  it("re-throws non-timeout errors from the executor agent without transitioning state", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store, initialRun);
    built.setExecutorError(new Error("boom: unexpected crash"));
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom: unexpected crash");
    expect(store.runState).toBe(RunState.Implementing);
  });

  it("recovers a stranded execution (ExecutionReport exists, EXECUTION_FINISHED never recorded) without re-invoking the executor", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, prNumber: 99 });
    const startedAt = new Date(Date.now() - 10_000);
    const reportCreatedAt = new Date(Date.now() - 5_000);
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({
          type: "ExecutionReport",
          version: 1,
          payloadJson: makeExecutionReport(),
          createdAt: reportCreatedAt,
        }),
      ],
      events: [
        {
          id: "evt-started",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_STARTED,
          source: "orchestrator",
          createdAt: startedAt,
        },
      ],
    };
    const built = buildDeps(store, initialRun);
    built.setReview(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runExecution("run-1");

    expect(built.executorAgent.run).not.toHaveBeenCalled();
    expect(built.reviewerAgent.run).toHaveBeenCalledTimes(1);
    const finishedEvent = store.events.find((e) => e.eventType === RunEvent.EXECUTION_FINISHED);
    expect(finishedEvent).toBeDefined();
    expect((finishedEvent?.payloadJson as { recovered: boolean }).recovered).toBe(true);
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("propagates a PolicyViolationError from assertExecutorPaths when the executor touches a protected path, without transitioning to AIReview", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store, initialRun);
    // Override the repo entry (via getRepoByName) is not used by buildTaskBundle's
    // protectedPaths for policy purposes here since assertExecutorPaths reads the
    // bundle produced by buildTaskBundle -- but getRepoByName supplies protectedPaths.
    (built.deps as { repoRegistry: { getRepoByName: ReturnType<typeof vi.fn> } }).repoRegistry.getRepoByName.mockReturnValue(
      {
        name: "test-repo",
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: ["src/secrets/"],
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 10,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      },
    );
    built.setExecutorResult({
      report: makeExecutionReport({ filesChanged: ["src/secrets/keys.ts"] }),
      prNumber: 1,
    });
    const svc = new OrchestratorService(built.deps as never);

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runExecution("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }

    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("executor_touched_protected_path");
    expect(store.events.map((e) => e.eventType)).not.toContain(RunEvent.EXECUTION_FINISHED);
  });

  it("propagates the PolicyViolationError from assertCanExecute when there is no approved plan version, without invoking the executor", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store, initialRun);
    const svc = new OrchestratorService(built.deps as never);

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runExecution("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }

    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("execute_requires_explicit_approval");
    expect(built.executorAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runReview", () => {
  it("approved verdict: sets reviewerRuntime, skips remediation, and marks ready", async () => {
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: 5 });
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [],
    };
    const built = buildDeps(store, initialRun);
    built.setReview(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runReview("run-1");

    expect(initialRun.reviewerRuntime).toBe("codex");
    expect(built.githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(store.events.map((e) => e.eventType)).toEqual([RunEvent.REVIEW_APPROVED]);
  });

  it("changes_requested verdict: posts findings to GitHub, forwards the comment map into remediation, and drives the remediation lane", async () => {
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: 5 });
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [],
    };
    const built = buildDeps(store, initialRun);
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
      ],
    });
    built.setReview(review);
    const svc = new OrchestratorService(built.deps as never);

    // NOTE: assertCanMarkReady requires the *latest* Review artifact to carry an
    // "approved" verdict, but the remediation lane does not re-run review before
    // calling markReady -- so this chain is expected to surface that pre-existing
    // policy violation once remediation finishes. That is what we assert on: it
    // proves postReviewFindings/postRemediationResolutions were correctly wired
    // with the same comment map before the (documented, out-of-scope) failure.
    let caught: PolicyViolationError | undefined;
    try {
      await svc.runReview("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }

    expect(built.githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      5,
      review.findings,
      "changes_requested",
    );
    expect(built.githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      5,
      expect.any(Array),
      { f1: 123 },
    );
    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("ready_requires_approved_verdict");
    expect(store.events.map((e) => e.eventType)).toEqual([
      RunEvent.REVIEW_CHANGES_REQUESTED,
      RunEvent.REMEDIATION_FINISHED,
      RunEvent.REVIEW_APPROVED,
    ]);
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("sets approvedPlanVersion from the latest plan artifact and transitions to Implementing", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: null });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 3, payloadJson: makePlan({ planVersion: 3 }) })],
      events: [],
    };
    const built = buildDeps(store, initialRun);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approvePlan("run-1");

    expect(initialRun.approvedPlanVersion).toBe(3);
    expect(result.state).toBe(RunState.Implementing);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Plan v3 approved. Starting implementation..."),
    );
  });

  it("includes the operator note in the approval comment when provided", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: null });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) })],
      events: [],
    };
    const built = buildDeps(store, initialRun);
    const svc = new OrchestratorService(built.deps as never);

    await svc.approvePlan("run-1", { note: "prioritize security" });

    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("prioritize security"),
    );
  });

  it("throws when there is no plan artifact for the run", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const store: TestStore = { runState: RunState.AwaitingPlanApproval, artifacts: [], events: [] };
    const built = buildDeps(store, initialRun);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, cleans up the worktree, and updates skill metrics on success", async () => {
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const store: TestStore = {
      runState: RunState.ReadyForHumanReview,
      artifacts: [],
      events: [
        {
          id: "evt-skill",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-1", "skill-2"] },
          createdAt: new Date(),
        },
      ],
    };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn().mockResolvedValue({ id: "skill-1" }),
      incrementFailure: vi.fn().mockResolvedValue({ id: "skill-x" }),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
    const built = buildDeps(store, initialRun, { agentSkillRepo, distillationAgent });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    expect(result.state).toBe(RunState.Done);
    expect(built.gitService.removeWorktree).toHaveBeenCalledWith("/tmp/main-repo", "/tmp/worktree");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Done"),
    );
  });

  it("swallows distillation errors (logs a warning) and still completes the run", async () => {
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [], events: [] };
    const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("distillation crashed")) };
    const built = buildDeps(store, initialRun, { distillationAgent });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation crashed" }),
      expect.stringContaining("Distillation agent failed"),
    );
  });

  it("skips distillation entirely when no distillationAgent dependency is configured", async () => {
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [], events: [] };
    const built = buildDeps(store, initialRun);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });

  it("does not fail run completion when a skill-metric update throws (per-skill errors are caught and logged)", async () => {
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const store: TestStore = {
      runState: RunState.ReadyForHumanReview,
      artifacts: [],
      events: [
        {
          id: "evt-skill",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-err"] },
          createdAt: new Date(),
        },
      ],
    };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn().mockRejectedValue(new Error("db down")),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const built = buildDeps(store, initialRun, { agentSkillRepo });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-err", error: "db down" }),
      expect.stringContaining("Failed to update skill metric"),
    );
  });

  it("does not clean up the worktree when the run's workingDirectory already IS the main repo path", async () => {
    const initialRun = makeRun({
      state: RunState.ReadyForHumanReview,
      workingDirectory: "/tmp/main-repo",
    });
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [], events: [] };
    const built = buildDeps(store, initialRun);
    built.gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-repo");
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview("run-1");

    expect(built.gitService.removeWorktree).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it.each(["approved", "changes_requested"] as const)(
    "always returns to AwaitingPlanApproval regardless of verdict (%s)",
    async (verdict) => {
      const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
      const store: TestStore = {
        runState: RunState.AwaitingPlanApproval,
        artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
        events: [],
      };
      const built = buildDeps(store, initialRun);
      (built.deps as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }).planReviewerAgent.run =
        vi.fn().mockResolvedValue({
          reviewId: "pr-1",
          summary: "s",
          findings: [],
          overallVerdict: verdict,
        });
      const svc = new OrchestratorService(built.deps as never);

      const result = await svc.runManualReReview("run-1");

      expect(result.state).toBe(RunState.AwaitingPlanApproval);
      expect(store.events.map((e) => e.eventType)).toEqual([
        RunEvent.RE_REVIEW_REQUESTED,
        RunEvent.PLAN_REVIEW_APPROVED,
      ]);
    },
  );
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("approved verdict: stays at AwaitingPlanApproval without triggering a revision", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store, initialRun);
    (built.deps as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }).planReviewerAgent.run =
      vi.fn().mockResolvedValue({
        reviewId: "pr-1",
        summary: "s",
        findings: [],
        overallVerdict: "approved",
      });
    (built.deps as { planReviserAgent: { run: ReturnType<typeof vi.fn> } }).planReviserAgent.run =
      vi.fn();
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(
      (built.deps as { planReviserAgent: { run: ReturnType<typeof vi.fn> } }).planReviserAgent.run,
    ).not.toHaveBeenCalled();
    expect(store.events.map((e) => e.eventType)).toEqual([
      RunEvent.RE_REVIEW_REQUESTED,
      RunEvent.PLAN_REVIEW_APPROVED,
    ]);
  });

  it("changes_requested verdict: drives a plan revision back to AwaitingPlanApproval", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store, initialRun);
    (built.deps as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }).planReviewerAgent.run =
      vi.fn().mockResolvedValue({
        reviewId: "pr-1",
        summary: "needs work",
        findings: [
          { id: "f1", severity: "important", type: "gap", title: "t", details: "d" },
        ],
        overallVerdict: "changes_requested",
      });
    (built.deps as { planReviserAgent: { run: ReturnType<typeof vi.fn> } }).planReviserAgent.run =
      vi.fn().mockResolvedValue({
        revision: {
          dispositions: [{ findingId: "f1", status: "accepted", rationale: "fair point" }],
        },
        revisedPlan: makePlan({ planVersion: 2 }),
      });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(initialRun.planVersion).toBe(2);
    expect(store.events.map((e) => e.eventType)).toEqual([
      RunEvent.RE_REVIEW_REQUESTED,
      RunEvent.PLAN_REVIEW_CHANGES_REQUESTED,
      RunEvent.PLAN_REVISED,
    ]);
  });
});
