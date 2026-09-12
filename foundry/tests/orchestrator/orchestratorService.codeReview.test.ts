import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
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
    prNumber: 5,
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

function makePlan(): Plan {
  return {
    planVersion: 1,
    summary: "Test plan",
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

  const eventRepo = {
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
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

  const githubClient = { getPRDiff: vi.fn().mockResolvedValue("diff --git a/src/foo.ts") };

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
    postReviewFindings: vi.fn().mockResolvedValue(new Map([["f1", 101]])),
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
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    githubSync,
    reviewerAgent,
    remediationAgent,
  };
}

describe("OrchestratorService.runReview -- policy guard", () => {
  it("throws PolicyViolationError when the run is not in AIReview", async () => {
    const store: TestStore = { run: makeRun({ state: RunState.Implementing }), artifacts: [] };
    const { deps, reviewerAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runReview("run-1")).rejects.toMatchObject({
      rule: "review_requires_ai_review_state",
    });
    expect(reviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runReview -- approved verdict", () => {
  it("transitions to ReadyForHumanReview and calls markReady when the review is clean", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [
        makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
    };
    const { deps, reviewerAgent, linearClient } = buildDeps(store);
    reviewerAgent.run.mockImplementation(async () => {
      const review = { reviewId: "rev-1", overallVerdict: "approved", summary: "Clean", findings: [] };
      store.artifacts.push(makeArtifact({ type: "Review", version: 1, payloadJson: review }));
      return review;
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runReview("run-1");

    expect(result.state).toBe(RunState.ReadyForHumanReview);
    const readyComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Ready for Human Review"),
    );
    expect(readyComment).toBeDefined();
  });

  it("rejects before computing a diff when the run has no prNumber (assertCanReview guards first)", async () => {
    // Note: runReview's `run.prNumber ? getPRDiff() : ""` false-branch is
    // unreachable via the public API -- assertCanReview already requires
    // run.prNumber and throws before the diff/reviewer call is ever reached.
    const store: TestStore = {
      run: makeRun({ prNumber: null }),
      artifacts: [
        makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
    };
    const { deps, reviewerAgent, githubClient } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runReview("run-1")).rejects.toMatchObject({ rule: "review_requires_pr" });

    expect(githubClient.getPRDiff).not.toHaveBeenCalled();
    expect(reviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runReview -- changes_requested verdict", () => {
  it("posts review findings to GitHub, builds the commentMap, and hands off to remediation", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [
        makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
    };
    const { deps, reviewerAgent, githubSync, remediationAgent, eventRepo } = buildDeps(store);
    reviewerAgent.run.mockImplementation(async () => {
      const review = {
        reviewId: "rev-1",
        overallVerdict: "changes_requested",
        summary: "Needs fixes",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "Fix it" },
        ],
      };
      store.artifacts.push(makeArtifact({ type: "Review", version: 1, payloadJson: review }));
      return review;
    });
    remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "Fixed", rationale: "r" }],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2 }),
    });
    const svc = new OrchestratorService(deps as never);

    // markReady eventually fails because the Review artifact is still the
    // original "changes_requested" one (remediation doesn't create a new
    // Review artifact) -- a real, meaningful boundary in this flow.
    await expect(svc.runReview("run-1")).rejects.toMatchObject({
      rule: "ready_requires_approved_verdict",
    });

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      5,
      expect.arrayContaining([expect.objectContaining({ id: "f1" })]),
      "changes_requested",
    );
    expect(remediationAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ overallVerdict: "changes_requested" }),
      expect.objectContaining({ executionVersion: 1 }),
      "/tmp/worktree",
      "run-1",
    );

    const eventTypes = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.REVIEW_CHANGES_REQUESTED);
    expect(eventTypes).toContain(RunEvent.REMEDIATION_FINISHED);
  });

  it("does not call postReviewFindings when there are no findings", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [
        makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
    };
    const { deps, reviewerAgent, githubSync, remediationAgent } = buildDeps(store);
    reviewerAgent.run.mockImplementation(async () => {
      const review = {
        reviewId: "rev-1",
        overallVerdict: "changes_requested",
        summary: "Needs fixes but no findings recorded",
        findings: [],
      };
      store.artifacts.push(makeArtifact({ type: "Review", version: 1, payloadJson: review }));
      return review;
    });
    remediationAgent.run.mockRejectedValue(new Error("remediation guard should stop first"));
    const svc = new OrchestratorService(deps as never);

    // assertCanRemediate requires non-empty findings, so this should fail
    // there -- proving postReviewFindings was correctly skipped beforehand.
    await expect(svc.runReview("run-1")).rejects.toMatchObject({
      rule: "remediate_requires_findings",
    });

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
  });
});
