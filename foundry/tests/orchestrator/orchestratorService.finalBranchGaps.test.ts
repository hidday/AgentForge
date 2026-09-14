import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { PlanReview } from "../../src/schemas/planReview.js";

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
    state: RunState.Planning,
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
    scoreRationale: "Solid.",
    ...overrides,
  };
}

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown; createdAt?: Date }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: overrides.createdAt ?? new Date(),
  };
}

interface TestStore {
  runState: RunState;
  artifacts: Artifact[];
  runPatch: Partial<Run>;
  events: RunEventRecord[];
}

function buildDeps(store: TestStore, initialRun: Run, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ ...initialRun, ...store.runPatch, state: store.runState }),
      ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, ...store.runPatch, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      store.runPatch = { ...store.runPatch, ...patch };
      return Promise.resolve({ ...initialRun, ...store.runPatch, state: store.runState });
    }),
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
      return Promise.resolve(matching.reduce((best, cur) => (cur.version > best.version ? cur : best)));
    }),
  };

  let eventIdCounter = 0;
  const eventRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const rec: RunEventRecord = {
        id: `event-${++eventIdCounter}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(rec);
      return Promise.resolve(rec);
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

  const githubClient = { getPRDiff: vi.fn().mockResolvedValue("diff"), getDefaultBranch: vi.fn().mockResolvedValue("main") };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(null),
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
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "OK",
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
    linearClient,
    githubClient,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    executorAgent,
    reviewerAgent,
    remediationAgent,
    repoRegistry,
    logger,
  };
}

describe("OrchestratorService.runPlanning -- no previous Plan artifact", () => {
  it("omits previousPlan from the planner call when there is no prior Plan artifact", async () => {
    const store: TestStore = { runState: RunState.Planning, artifacts: [], runPatch: { planVersion: 1 }, events: [] };
    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const { deps, plannerAgent } = buildDeps(store, initialRun);
    plannerAgent.run.mockImplementation(async () => {
      const plan = makePlan({ planVersion: 2, openQuestions: [] });
      store.artifacts.push(asArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan }));
      return plan;
    });

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({ previousPlan: expect.anything() }),
    );
  });
});

describe("OrchestratorService.retryRun -- repoRegistry fallback to default repo", () => {
  it("falls back to getDefaultRepo when getRepoByName returns null", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], runPatch: {}, events: [] };
    const initialRun = makeRun({ state: RunState.Todo, branchName: null });
    const { deps, repoRegistry, plannerAgent } = buildDeps(store, initialRun);
    repoRegistry.getRepoByName.mockReturnValue(null);
    plannerAgent.run.mockImplementation(async () => {
      const plan = makePlan({ planVersion: 1, openQuestions: [] });
      store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: plan }));
      return plan;
    });

    const svc = new OrchestratorService(deps as never);
    await svc.retryRun("run-1");

    expect(repoRegistry.getDefaultRepo).toHaveBeenCalled();
  });
});

describe("OrchestratorService.runPlanRevision -- existing PlanReview artifact is passed to the reviser", () => {
  it("reads a persisted PlanReview artifact (not undefined) when one exists", async () => {
    const plan = makePlan({ planVersion: 1 });
    const planReview: PlanReview = {
      reviewId: "pr-1",
      summary: "Needs another look",
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "blocker", type: "gap", title: "t", details: "d" }],
    };
    const store: TestStore = {
      runState: RunState.PlanRevision,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({ type: "PlanReview", version: 1, payloadJson: planReview }),
      ],
      runPatch: {},
      events: [],
    };
    const initialRun = makeRun({ state: RunState.PlanRevision });
    const { deps, planReviserAgent } = buildDeps(store, initialRun);
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});

describe("OrchestratorService.runExecution -- operator note forwarded to the executor", () => {
  it("passes { operatorNote } to executorAgent.run when opts.note is provided", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      runPatch: {},
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    const { deps, executorAgent, reviewerAgent } = buildDeps(store, initialRun);
    executorAgent.run.mockImplementation(async () => {
      const report = makeExecutionReport();
      store.artifacts.push(asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }));
      return { report, prNumber: 3 };
    });
    reviewerAgent.run.mockImplementation(async () => {
      const review: Review = { reviewId: "rev-1", summary: "ok", findings: [], overallVerdict: "changes_requested" };
      store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
      return review;
    });

    const svc = new OrchestratorService(deps as never);
    // changes_requested review flows into remediation and eventually markReady, which will
    // throw for policy reasons unrelated to this assertion; we only care that the executor
    // received the operator note.
    try {
      await svc.runExecution("run-1", { note: "focus on perf" });
    } catch {
      // expected -- markReady policy gap, not under test here.
    }

    expect(executorAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      expect.objectContaining({ existingBranch: null }),
      { operatorNote: "focus on perf" },
    );
  });
});

describe("OrchestratorService.runExecution -- stale EXECUTION_FINISHED does not block recovery detection", () => {
  it("recovers when the only EXECUTION_FINISHED event predates the (newer) stranded ExecutionReport", async () => {
    const plan = makePlan({ planVersion: 1 });
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:05:00Z"); // first EXECUTION_FINISHED (stale, from an earlier attempt)
    const t2 = new Date("2026-01-01T00:10:00Z"); // second EXECUTION_STARTED (retry)
    const t3 = new Date("2026-01-01T00:15:00Z"); // stranded ExecutionReport, created after t2 and after t1

    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({
          type: "ExecutionReport",
          version: 1,
          payloadJson: makeExecutionReport(),
          createdAt: t3,
        }),
      ],
      runPatch: {},
      events: [
        { id: "e1", runId: "run-1", eventType: RunEvent.EXECUTION_STARTED, source: "orchestrator", payloadJson: {}, createdAt: t0 },
        { id: "e2", runId: "run-1", eventType: RunEvent.EXECUTION_FINISHED, source: "executor-agent", payloadJson: {}, createdAt: t1 },
        { id: "e3", runId: "run-1", eventType: RunEvent.EXECUTION_STARTED, source: "orchestrator", payloadJson: {}, createdAt: t2 },
      ],
    };
    const initialRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, prNumber: 11 });
    const { deps, executorAgent, reviewerAgent } = buildDeps(store, initialRun);
    reviewerAgent.run.mockImplementation(async () => {
      const review: Review = { reviewId: "rev-1", summary: "ok", findings: [], overallVerdict: "approved" };
      store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
      return review;
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });
});

describe("OrchestratorService.runReview -- changes_requested flowing into a fully successful remediation", () => {
  it("completes runRemediation without throwing when the post-remediation Review is approved", async () => {
    const plan = makePlan({ planVersion: 1 });
    const executionReport = makeExecutionReport();
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: executionReport }),
      ],
      runPatch: {},
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: 10, branchName: "ai/run-1" });
    const { deps, reviewerAgent, remediationAgent } = buildDeps(store, initialRun);

    reviewerAgent.run.mockImplementation(async () => {
      const review: Review = {
        reviewId: "rev-1",
        summary: "Needs a fix",
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" }],
      };
      store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
      return review;
    });

    remediationAgent.run.mockImplementation(async () => {
      const newReport = makeExecutionReport({ executionVersion: 2, score: 0.95 });
      store.artifacts.push(asArtifact({ type: "ExecutionReport", version: 2, payloadJson: newReport }));
      // Simulate the Review being flipped to approved out-of-band so markReady succeeds.
      store.artifacts.push(
        asArtifact({
          type: "Review",
          version: 2,
          payloadJson: { reviewId: "rev-1", summary: "Fixed", overallVerdict: "approved", findings: [] },
        }),
      );
      return {
        reviewId: "rev-1",
        resolution: [{ findingId: "f1", status: "accepted", action: "Fixed", rationale: "r" }],
        readyForHumanReview: true,
        executionReport: newReport,
      };
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runReview("run-1");

    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });
});

describe("OrchestratorService -- private comment-formatting helpers (final gaps)", () => {
  interface FormatPrivateAccess {
    formatExecutionReportComment(report: ExecutionReport): string;
    formatPlanReviewComment(planReview: PlanReview): string;
    formatCodeReviewComment(review: Review): string;
  }

  function asFormatters(svc: OrchestratorService): FormatPrivateAccess {
    return svc as unknown as FormatPrivateAccess;
  }

  it("formatExecutionReportComment renders the neutral icon for a 'skip' check status and omits the files section when there are no files", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], runPatch: {}, events: [] };
    const { deps } = buildDeps(store, makeRun());
    const svc = new OrchestratorService(deps as never);

    const report = makeExecutionReport({
      filesChanged: [],
      checks: {
        lint: { status: "fail", details: "lint errors" },
        typecheck: { status: "skip", details: "not configured" },
        tests: { status: "pass", details: "ok" },
      },
    });
    const text = asFormatters(svc).formatExecutionReportComment(report);

    expect(text).toContain(":x:");
    expect(text).toContain(":heavy_minus_sign:");
    expect(text).toContain(":white_check_mark:");
    expect(text).not.toContain("### Files changed");
    expect(text).not.toContain("<details>");
  });

  it("formatPlanReviewComment renders 'Approved' for an approved verdict", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], runPatch: {}, events: [] };
    const { deps } = buildDeps(store, makeRun());
    const svc = new OrchestratorService(deps as never);

    const planReview: PlanReview = {
      reviewId: "pr-1",
      summary: "Looks solid",
      overallVerdict: "approved",
      findings: [],
    };
    const text = asFormatters(svc).formatPlanReviewComment(planReview);

    expect(text).toContain("## AI Plan Review -- Approved");
  });

  it("formatCodeReviewComment renders 'Approved' for an approved verdict", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], runPatch: {}, events: [] };
    const { deps } = buildDeps(store, makeRun());
    const svc = new OrchestratorService(deps as never);

    const review: Review = {
      reviewId: "rev-1",
      summary: "Looks solid",
      overallVerdict: "approved",
      findings: [],
    };
    const text = asFormatters(svc).formatCodeReviewComment(review);

    expect(text).toContain("## AI Code Review -- Approved");
  });
});
