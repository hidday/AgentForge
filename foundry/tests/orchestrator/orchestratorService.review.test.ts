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
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: 42,
    state: RunState.AIReview,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: "claude-code",
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/worktree",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(): Plan {
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
    scoreRationale: "All green.",
    ...overrides,
  };
}

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version}-${Math.random()}`,
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

function buildDeps(store: TestStore, initialRun: Run) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...initialRun, state: store.runState })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) =>
      Promise.resolve({ ...initialRun, state: store.runState, ...patch }),
    ),
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
    create: vi.fn().mockImplementation((params: { eventType: string; source: string; payloadJson?: unknown; runId: string }) => {
      const rec: RunEventRecord = {
        id: `event-${store.events.length}`,
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
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff content"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

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
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn().mockResolvedValue(new Map([["f1", 101]])),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };

  const remediationAgent = {
    run: vi.fn().mockImplementation(async (_review: Review, execReport: ExecutionReport, _wd: string, runId: string) => {
      const newReport = makeExecutionReport({
        executionVersion: execReport.executionVersion + 1,
        score: 0.95,
        scoreRationale: "Fixed.",
      });
      await artifactRepo.create({ runId, type: "ExecutionReport", version: newReport.executionVersion, payloadJson: newReport, rawText: "{}" });
      const remediation = {
        reviewId: "rev-001",
        resolution: [{ findingId: "f1", status: "accepted" as const, action: "Fixed", rationale: "Real bug" }],
        readyForHumanReview: true,
        executionReport: newReport,
      };
      await artifactRepo.create({ runId, type: "Remediation", version: 1, payloadJson: remediation, rawText: "{}" });
      return remediation;
    }),
  };

  const gitService = {
    setupRunWorktree: vi.fn(),
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
      logger,
      dashboardEmitter,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    githubSync,
    reviewerAgent,
    remediationAgent,
    logger,
  };
}

describe("OrchestratorService.runReview", () => {
  it("approved verdict with no findings: skips postReviewFindings and proceeds to markReady (ReadyForHumanReview)", async () => {
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const built = buildDeps(store, initialRun);
    const svc = new OrchestratorService(built.deps as never);

    built.reviewerAgent.run.mockImplementation(async (_plan, _exec, _diff, _bundle, runId: string) => {
      const review: Review = { reviewId: "rev-001", summary: "Clean", findings: [], overallVerdict: "approved" };
      await built.artifactRepo.create({ runId, type: "Review", version: 1, payloadJson: review, rawText: "{}" });
      return review;
    });

    const result = await svc.runReview("run-1");

    expect(built.githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(built.runRepo.update).toHaveBeenCalledWith("run-1", { reviewerRuntime: "codex" });
    expect(result.state).toBe(RunState.ReadyForHumanReview);

    const eventTypes = store.events.map((e) => e.eventType);
    expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);
    expect(eventTypes).not.toContain(RunEvent.REVIEW_CHANGES_REQUESTED);

    // markReady's final comment was posted
    const finalComment = built.linearClient.postComment.mock.calls
      .map((c: unknown[]) => c[1] as string)
      .find((b: string) => b.includes("Ready for Human Review"));
    expect(finalComment).toBeDefined();
  });

  it("approved verdict with findings present and a PR: posts review findings to GitHub and builds a commentMap", async () => {
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const built = buildDeps(store, initialRun);
    const svc = new OrchestratorService(built.deps as never);

    built.reviewerAgent.run.mockImplementation(async (_plan, _exec, _diff, _bundle, runId: string) => {
      const review: Review = {
        reviewId: "rev-002",
        summary: "Minor nit",
        findings: [
          { id: "f1", severity: "minor", type: "style", file: "src/foo.ts", title: "Nit", details: "..." },
        ],
        overallVerdict: "approved",
      };
      await built.artifactRepo.create({ runId, type: "Review", version: 1, payloadJson: review, rawText: "{}" });
      return review;
    });

    await svc.runReview("run-1");

    expect(built.githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.arrayContaining([expect.objectContaining({ id: "f1" })]),
      "approved",
    );
  });

  it("changes_requested verdict: posts code review comment and triggers remediation (markReady then rejects, pre-existing: remediation never re-establishes an approved Review verdict)", async () => {
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const built = buildDeps(store, initialRun);
    const svc = new OrchestratorService(built.deps as never);

    built.reviewerAgent.run.mockImplementation(async (_plan, _exec, _diff, _bundle, runId: string) => {
      const review: Review = {
        reviewId: "rev-003",
        summary: "Found a bug",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "src/foo.ts", lineHint: 10, title: "Bug", details: "Real issue" },
          { id: "f2", severity: "minor", type: "style", file: "src/bar.ts", title: "Nit", details: "No line hint for this one" },
        ],
        overallVerdict: "changes_requested",
      };
      await built.artifactRepo.create({ runId, type: "Review", version: 1, payloadJson: review, rawText: "{}" });
      return review;
    });

    let caught: unknown;
    try {
      await svc.runReview("run-1");
    } catch (err) {
      caught = err;
    }
    expect((caught as { rule?: string } | undefined)?.rule).toBe("ready_requires_approved_verdict");

    const eventTypes = store.events.map((e) => e.eventType);
    expect(eventTypes).toContain(RunEvent.REVIEW_CHANGES_REQUESTED);
    expect(eventTypes).toContain(RunEvent.REMEDIATION_FINISHED);
    expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);

    const codeReviewComment = built.linearClient.postComment.mock.calls
      .map((c: unknown[]) => c[1] as string)
      .find((b: string) => b.includes("AI Code Review"));
    expect(codeReviewComment).toBeDefined();
    expect(codeReviewComment).toContain("Changes Requested");
    expect(codeReviewComment).toContain("src/foo.ts:10");

    expect(built.remediationAgent.run).toHaveBeenCalledTimes(1);
    // commentMap built from postReviewFindings result was forwarded into remediation
    expect(built.githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.anything(),
      { f1: 101 },
    );

    // The REVIEW_APPROVED transition (AIReview -> ReadyForHumanReview) is recorded
    // before markReady's policy check runs and throws.
    expect(store.runState).toBe(RunState.ReadyForHumanReview);
  });
});

describe("OrchestratorService.markReady", () => {
  function buildMarkReadyDeps(run: Run, review: Review | null, report: ExecutionReport | null) {
    const runRepo = { findById: vi.fn().mockResolvedValue(run), findActiveByIssueId: vi.fn(), findAll: vi.fn(), create: vi.fn(), findByIssueId: vi.fn(), updateState: vi.fn(), update: vi.fn() };
    const artifactRepo = {
      create: vi.fn(),
      findByRunId: vi.fn(),
      findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
        if (type === "Review") return Promise.resolve(review ? asArtifact({ type: "Review", version: 1, payloadJson: review }) : null);
        if (type === "ExecutionReport") return Promise.resolve(report ? asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }) : null);
        return Promise.resolve(null);
      }),
    };
    const eventRepo = { create: vi.fn(), findByRunId: vi.fn().mockResolvedValue([]) };
    const linearClient = { getIssue: vi.fn(), postComment: vi.fn().mockResolvedValue(undefined) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const deps = {
      runRepo,
      artifactRepo,
      eventRepo,
      linearClient,
      githubClient: { getPRDiff: vi.fn() },
      gitService: { resolveMainRepoPath: vi.fn() },
      repoRegistry: { resolveForIssue: vi.fn(), resolveWorkingDirectory: vi.fn(), validateWorkingDirectory: vi.fn(), getRepoByName: vi.fn(), getDefaultRepo: vi.fn() },
      linearSync: { syncState: vi.fn() },
      githubSync: { syncState: vi.fn(), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() },
      plannerAgent: { run: vi.fn() },
      planReviewerAgent: { run: vi.fn() },
      planReviserAgent: { run: vi.fn() },
      executorAgent: { run: vi.fn() },
      reviewerAgent: { run: vi.fn() },
      remediationAgent: { run: vi.fn() },
      logger,
    };
    return { deps, linearClient };
  }

  it("posts the final 'Ready for Human Review' comment when all mark-ready conditions are satisfied", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42 });
    const review: Review = { reviewId: "r1", summary: "ok", findings: [], overallVerdict: "approved" };
    const report = makeExecutionReport();
    const { deps, linearClient } = buildMarkReadyDeps(run, review, report);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.markReady("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });
});
