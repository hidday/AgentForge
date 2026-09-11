import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, ArtifactType, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { Remediation } from "../../src/schemas/remediation.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Test issue",
    linearIssueUrl: "https://linear.app/x/issue/ENG-1",
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: 42,
    state: RunState.AIReview,
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
    summary: "Implemented the feature.",
    filesChanged: ["src/a.ts"],
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

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Reviewed",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

const REPO_ENTRY = {
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

// ---------------------------------------------------------------------------
// Stateful harness (duplicated per-file by convention -- see
// orchestratorService.lifecycle.test.ts for the canonical shape).
// ---------------------------------------------------------------------------

interface Store {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function makeArtifact(store: Store, type: ArtifactType, version: number, payloadJson: unknown): Artifact {
  return {
    id: `artifact-${type}-${version}`,
    runId: store.run.id,
    type,
    version,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt: new Date(),
  };
}

/**
 * Queues a single reviewerAgent.run() resolution AND -- mirroring what the
 * real ReviewerAgent does in production -- persists the resulting Review as
 * an artifact, so that assertCanRemediate()/assertCanMarkReady() (which read
 * the latest Review artifact) can find it.
 */
function queueReviewerResult(
  h: { reviewerAgent: { run: ReturnType<typeof vi.fn> }; store: Store },
  review: Review,
) {
  h.reviewerAgent.run.mockImplementationOnce(async () => {
    const existing = h.store.artifacts.filter((a) => a.type === "Review");
    const version = existing.length === 0 ? 1 : Math.max(...existing.map((a) => a.version)) + 1;
    h.store.artifacts.push(makeArtifact(h.store, "Review", version, review));
    return review;
  });
}

function buildHarness(initialRun: Run, initialArtifacts: Artifact[] = []) {
  const store: Store = { run: initialRun, artifacts: [...initialArtifacts], events: [] };

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
      .mockImplementation(
        (params: { runId: string; type: string; version: number; payloadJson: unknown }) => {
          const a = makeArtifact(store, params.type as ArtifactType, params.version, params.payloadJson);
          store.artifacts.push(a);
          return Promise.resolve(a);
        },
      ),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      return Promise.resolve(matching.reduce((best, cur) => (cur.version > best.version ? cur : best)));
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const evt: RunEventRecord = {
        id: `event-${store.events.length}`,
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
      project: "test-project",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff content"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(REPO_ENTRY),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(REPO_ENTRY),
    getDefaultRepo: vi.fn().mockReturnValue(REPO_ENTRY),
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
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/worktree"),
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

  const deps = {
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

  return {
    store,
    deps,
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    githubSync,
    gitService,
    reviewerAgent,
    remediationAgent,
    logger,
  };
}

// ---------------------------------------------------------------------------
// runReview
// ---------------------------------------------------------------------------

describe("OrchestratorService.runReview", () => {
  it("approved verdict: skips postReviewFindings (no findings) and marks the run ready directly", async () => {
    const initialRun = makeRun();
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan()));
    h.store.artifacts.push(
      makeArtifact(h.store, "ExecutionReport", 1, makeExecutionReport()),
    );

    queueReviewerResult(h, makeReview({ overallVerdict: "approved", findings: [] }));

    const result = await svc.runReview("run-1");

    expect(h.githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.ReadyForHumanReview);
    const comment = h.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Ready for Human Review"),
    );
    expect(comment).toBeDefined();
  });

  it("changes_requested verdict: posts findings to GitHub, formats the code review comment, and cascades into remediation ending at ReadyForHumanReview", async () => {
    const initialRun = makeRun();
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan()));
    h.store.artifacts.push(
      makeArtifact(h.store, "ExecutionReport", 1, makeExecutionReport()),
    );

    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "src/a.ts", title: "Bad bug", details: "fix it" },
      ],
    });
    queueReviewerResult(h, review);
    h.githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 123]]));

    // Simulate a RemediationAgent that resolves the finding, bumps the
    // ExecutionReport to v2, AND (for test purposes) records a fresh
    // approved Review so the cascade can complete all the way through
    // markReady() -- exercising OrchestratorService's own control flow.
    h.remediationAgent.run.mockImplementation(async (): Promise<Remediation> => {
      const newReport = makeExecutionReport({ executionVersion: 2, score: 0.95 });
      h.store.artifacts.push(makeArtifact(h.store, "ExecutionReport", 2, newReport));
      h.store.artifacts.push(
        makeArtifact(h.store, "Review", 2, makeReview({ overallVerdict: "approved", findings: [] })),
      );
      return {
        reviewId: review.reviewId,
        resolution: [
          { findingId: "f1", status: "accepted", action: "Fixed the bug", rationale: "root cause addressed" },
        ],
        readyForHumanReview: true,
        executionReport: newReport,
      };
    });

    const result = await svc.runReview("run-1");

    expect(h.githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      42,
      review.findings,
      "changes_requested",
    );

    const changesComment = h.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("AI Code Review"),
    )?.[1] as string;
    expect(changesComment).toContain("Changes Requested");
    expect(changesComment).toContain("Bad bug");

    expect(h.remediationAgent.run).toHaveBeenCalledTimes(1);
    // The commentMap built from postReviewFindings must be threaded through
    // to postRemediationResolutions.
    expect(h.githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.any(Array),
      { f1: 123 },
    );

    // Full cascade completed: remediation -> REVIEW_APPROVED -> markReady -> ReadyForHumanReview.
    expect(result.state).toBe(RunState.ReadyForHumanReview);
    const eventTypes = h.store.events.map((e) => e.eventType);
    expect(eventTypes).toContain(RunEvent.REMEDIATION_FINISHED);
    expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);
  });

  it("throws a PolicyViolationError when the run is not in the AIReview state", async () => {
    const initialRun = makeRun({ state: RunState.Implementing });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(
      makeArtifact(h.store, "ExecutionReport", 1, makeExecutionReport()),
    );

    await expect(svc.runReview("run-1")).rejects.toThrow(/Cannot review when run is in state/);
    expect(h.reviewerAgent.run).not.toHaveBeenCalled();
  });
});
