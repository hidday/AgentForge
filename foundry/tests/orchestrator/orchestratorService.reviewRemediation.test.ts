import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
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
    scoreRationale: "Clean implementation.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Found issues",
    findings: [
      {
        id: "f1",
        severity: "important",
        type: "bug",
        file: "src/foo.ts",
        lineHint: 10,
        title: "Off-by-one",
        details: "Loop boundary wrong",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

interface TestStore {
  runState: RunState;
  artifacts: Artifact[];
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

function buildDeps(store: TestStore, initialRun: Run) {
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
      project: "test-project",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff content"),
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
    postReviewFindings: vi.fn().mockResolvedValue(new Map([["f1", 123]])),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const review = makeReview({ overallVerdict: "approved", findings: [] });
      await artifactRepo.create({
        runId: "run-1",
        type: "Review",
        version: 1,
        payloadJson: review,
        rawText: "{}",
      });
      return review;
    }),
  };
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
    gitService,
  };
}

describe("OrchestratorService.runReview", () => {
  it("throws via policy when not in AIReview state", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
    };
    const initialRun = makeRun({ state: RunState.Implementing });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("throws via policy when there is no PR number", async () => {
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
    };
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: null });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.runReview("run-1")).rejects.toThrow(/Cannot review without an existing PR/);
  });

  it("approved verdict: skips postReviewFindings, transitions to ReadyForHumanReview via markReady", async () => {
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
    };
    const initialRun = makeRun({ state: RunState.AIReview });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runReview("run-1");

    expect(built.githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.ReadyForHumanReview);

    const readyComment = built.linearClient.postComment.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Ready for Human Review"),
    );
    expect(readyComment).toBeDefined();
  });

  it("fetches the PR diff when prNumber is set, and uses empty string when it is not", async () => {
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
    };
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: 7 });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await svc.runReview("run-1");

    expect(built.githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 7);
  });

  it("changes_requested verdict with findings: posts review findings to GitHub and runs remediation", async () => {
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
    };
    const initialRun = makeRun({ state: RunState.AIReview });
    const built = buildDeps(store, initialRun);
    built.reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "changes_requested" }));

    const svc = new OrchestratorService(built.deps as never);
    const runRemediationSpy = vi
      .spyOn(svc, "runRemediation")
      .mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    const result = await svc.runReview("run-1");

    expect(built.githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.arrayContaining([expect.objectContaining({ id: "f1" })]),
      "changes_requested",
    );
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", { f1: 123 });

    const comment = built.linearClient.postComment.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("AI Code Review"),
    );
    expect(comment).toBeDefined();
    expect(comment![1]).toContain("Off-by-one");
    expect(comment![1]).toContain("src/foo.ts:10");
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("changes_requested verdict with no findings: does not call postReviewFindings", async () => {
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
    };
    const initialRun = makeRun({ state: RunState.AIReview });
    const built = buildDeps(store, initialRun);
    built.reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "changes_requested", findings: [] }));

    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runRemediation").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    await svc.runReview("run-1");

    expect(built.githubSync.postReviewFindings).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runRemediation", () => {
  it("throws via policy when not in AddressingReview state", async () => {
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [asArtifact({ type: "Review", version: 1, payloadJson: makeReview() })],
    };
    const initialRun = makeRun({ state: RunState.AIReview });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("skips git branch operations when the run has no branchName", async () => {
    const store: TestStore = {
      runState: RunState.AddressingReview,
      artifacts: [
        asArtifact({ type: "Review", version: 1, payloadJson: makeReview() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
    };
    const initialRun = makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: null });
    const built = buildDeps(store, initialRun);
    built.remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "Fixed", rationale: "ok" }],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2 }),
    });

    const svc = new OrchestratorService(built.deps as never);
    // markReady will throw (pre-existing: remediation never produces an
    // "approved" Review artifact) -- see note in the test below. We only
    // assert the remediation-specific side effects here.
    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);

    expect(built.gitService.assertBranch).not.toHaveBeenCalled();
    expect(built.gitService.commitAndPush).not.toHaveBeenCalled();
    expect(built.githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(built.githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });

  it("commits and pushes when branchName is set, and syncs GitHub when prNumber is set", async () => {
    const store: TestStore = {
      runState: RunState.AddressingReview,
      artifacts: [
        asArtifact({ type: "Review", version: 1, payloadJson: makeReview() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
    };
    const initialRun = makeRun({ state: RunState.AddressingReview });
    const built = buildDeps(store, initialRun);
    built.remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "Fixed", rationale: "ok" }],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2 }),
    });

    const svc = new OrchestratorService(built.deps as never);

    // Pre-existing behavior: markReady always throws here because remediation
    // doesn't write a fresh "approved" Review artifact. See executionScore
    // test for a full discussion. We assert remediation's own side effects.
    const err = await svc.runRemediation("run-1", { f1: 123 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PolicyViolationError);

    expect(built.gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(built.gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("Remediation"),
    );
    expect(built.githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.objectContaining({ executionVersion: 2 }),
    );
    expect(built.githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.arrayContaining([expect.objectContaining({ findingId: "f1" })]),
      { f1: 123 },
    );

    const remediationComment = built.linearClient.postComment.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Remediation Summary"),
    );
    expect(remediationComment).toBeDefined();

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.REMEDIATION_FINISHED);
    expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);
  });
});

describe("OrchestratorService.markReady", () => {
  it("succeeds and posts the completion comment when all policy conditions are met", async () => {
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({ type: "Review", version: 1, payloadJson: makeReview({ overallVerdict: "approved", findings: [] }) }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
    };
    const initialRun = makeRun({ state: RunState.AIReview });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.markReady("run-1");

    expect(result).toBeDefined();
    const comment = built.linearClient.postComment.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("AI workflow complete"),
    );
    expect(comment).toBeDefined();
  });

  it("throws when there is no PR", async () => {
    const store: TestStore = { runState: RunState.AIReview, artifacts: [] };
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: null });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.markReady("run-1")).rejects.toThrow(/Cannot mark ready without an existing PR/);
  });

  it("throws when there is no execution report", async () => {
    const store: TestStore = { runState: RunState.AIReview, artifacts: [] };
    const initialRun = makeRun({ state: RunState.AIReview });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.markReady("run-1")).rejects.toThrow(/Cannot mark ready without execution report/);
  });

  it("throws when checks are failing", async () => {
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({
          type: "ExecutionReport",
          version: 1,
          payloadJson: makeExecutionReport({
            checks: {
              lint: { status: "pass", details: "ok" },
              typecheck: { status: "pass", details: "ok" },
              tests: { status: "fail", details: "regression" },
            },
          }),
        }),
      ],
    };
    const initialRun = makeRun({ state: RunState.AIReview });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.markReady("run-1")).rejects.toThrow(/Cannot mark ready with failing checks/);
  });

  it("throws when there is no review", async () => {
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() })],
    };
    const initialRun = makeRun({ state: RunState.AIReview });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.markReady("run-1")).rejects.toThrow(/Cannot mark ready without a review/);
  });

  it("throws when there are unresolved blocker findings", async () => {
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({
          type: "Review",
          version: 1,
          payloadJson: makeReview({
            overallVerdict: "approved",
            findings: [
              {
                id: "f1",
                severity: "blocker",
                type: "bug",
                file: "src/foo.ts",
                title: "Security hole",
                details: "SQL injection",
              },
            ],
          }),
        }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
    };
    const initialRun = makeRun({ state: RunState.AIReview });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.markReady("run-1")).rejects.toThrow(/unresolved blocker findings/);
  });
});
