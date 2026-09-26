import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { Remediation } from "../../src/schemas/remediation.js";

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

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function asArtifact(overrides: {
  type: string;
  version: number;
  payloadJson: unknown;
  id?: string;
}): Artifact {
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
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildDeps(store: TestStore) {
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
    create: vi.fn().mockImplementation((params: {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
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
    postReviewFindings: vi.fn().mockResolvedValue(new Map([["f1", 100]])),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  // Simulates the real ReviewerAgent, which persists its Review artifact
  // itself before returning. Tests configure the verdict/findings via
  // `setReview`; the persisted artifact always mirrors what run() resolves.
  let currentReview: Review = makeReview();
  const reviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      await artifactRepo.create({
        runId: store.run.id,
        type: "Review",
        version: 1,
        payloadJson: currentReview,
      });
      return currentReview;
    }),
    setReview: (review: Review) => {
      currentReview = review;
    },
  };

  const remediationAgent = {
    run: vi.fn().mockImplementation(async (_review: Review, executionReport: ExecutionReport) => {
      const newReport: ExecutionReport = {
        ...executionReport,
        executionVersion: executionReport.executionVersion + 1,
      };
      const remediation: Remediation = {
        reviewId: "rev-1",
        resolution: [
          { findingId: "f1", status: "accepted", action: "fixed", rationale: "was real" },
        ],
        readyForHumanReview: true,
        executionReport: newReport,
      };
      await artifactRepo.create({
        runId: store.run.id,
        type: "ExecutionReport",
        version: newReport.executionVersion,
        payloadJson: newReport,
      });
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
    },
    runRepo,
    artifactRepo,
    eventRepo,
    reviewerAgent,
    remediationAgent,
    githubSync,
    linearClient,
  };
}

describe("OrchestratorService.runReview -- policy gating", () => {
  it("throws PolicyViolationError when run is not AIReview", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.Implementing }),
      artifacts: [asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() })],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runReview("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("review_requires_ai_review_state");
    expect(built.reviewerAgent.run).not.toHaveBeenCalled();
  });

  it("throws PolicyViolationError when there is no PR", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.AIReview, prNumber: null }),
      artifacts: [asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() })],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runReview("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("review_requires_pr");
  });

  it("throws PolicyViolationError when there is no ExecutionReport artifact", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.AIReview }),
      artifacts: [],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runReview("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("review_requires_execution_report");
  });
});

describe("OrchestratorService.runReview -- verdict branching", () => {
  function baseStore(): TestStore {
    return {
      run: makeRun({ state: RunState.AIReview }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [],
    };
  }

  it("approved verdict: transitions to ReadyForHumanReview via markReady, does not post GitHub review findings when findings are empty", async () => {
    const store = baseStore();
    const built = buildDeps(store);
    built.reviewerAgent.setReview(makeReview({ overallVerdict: "approved", findings: [] }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runReview("run-1");

    expect(built.githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("posts review findings to GitHub when the PR exists and findings are present, regardless of verdict", async () => {
    const store = baseStore();
    const built = buildDeps(store);
    built.reviewerAgent.setReview(
      makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "nit", type: "style", file: "src/foo.ts", title: "Nit", details: "minor" },
        ],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    await svc.runReview("run-1");

    expect(built.githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.arrayContaining([expect.objectContaining({ id: "f1" })]),
      "approved",
    );
  });

  it("changes_requested verdict: posts a Linear comment, transitions through AddressingReview, and runs remediation", async () => {
    const store = baseStore();
    const built = buildDeps(store);
    built.reviewerAgent.setReview(
      makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "real issue" },
        ],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    // Known pre-existing behaviour (also documented in
    // orchestratorService.executionScore.test.ts): runRemediation does not
    // re-run code review, so the stale "changes_requested" Review artifact
    // causes markReady's verdict check to fail at the very end of the chain.
    // We assert on that specific, expected failure to prove remediation
    // itself completed correctly before markReady's policy check runs.
    let caught: PolicyViolationError | undefined;
    try {
      await svc.runReview("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("ready_requires_approved_verdict");

    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Changes Requested"),
    );

    // Remediation should have run.
    expect(built.remediationAgent.run).toHaveBeenCalledTimes(1);
    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.REVIEW_CHANGES_REQUESTED);
    expect(eventTypes).toContain(RunEvent.REMEDIATION_FINISHED);
    // REVIEW_APPROVED is recorded by runRemediation right before the failing markReady call.
    expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);
  });

  it("passes the commentMap built from postReviewFindings through to remediation as GitHub thread ids", async () => {
    const store = baseStore();
    const built = buildDeps(store);
    built.reviewerAgent.setReview(
      makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "real issue" },
        ],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    // See the note in the previous test: markReady throws at the very end
    // because the stale Review artifact still says "changes_requested".
    // That happens after postRemediationResolutions, so we can still assert
    // on the commentMap handoff.
    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);

    // runRemediation -> postRemediationResolutions receives the commentMap (f1 -> 100)
    expect(built.githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.anything(),
      { f1: 100 },
    );
  });

  it("persists reviewerRuntime='codex' on the run", async () => {
    const store = baseStore();
    const built = buildDeps(store);
    built.reviewerAgent.setReview(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.runReview("run-1");

    expect(built.runRepo.update).toHaveBeenCalledWith("run-1", { reviewerRuntime: "codex" });
  });
});
