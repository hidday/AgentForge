import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
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

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Found a bug",
    findings: [
      { id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "Real issue" },
    ],
    overallVerdict: "changes_requested",
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

function buildDeps(store: TestStore, initialRun: Run) {
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
    create: vi.fn().mockImplementation((params: { eventType: string }) => {
      const evt: RunEventRecord = {
        id: `event-${store.events.length + 1}`,
        runId: "run-1",
        eventType: params.eventType,
        source: "test",
        payloadJson: {},
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
    gitService,
    linearClient,
  };
}

describe("OrchestratorService.runReview", () => {
  it("changes_requested: posts findings to GitHub, comments on Linear, and delegates to runRemediation with the comment map", async () => {
    const executionReport = makeExecutionReport();
    const plan = { planVersion: 1, summary: "s", steps: [] };
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: executionReport }),
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
      ],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const { deps, reviewerAgent, githubSync, linearClient } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);
    const runRemediationSpy = vi
      .spyOn(svc, "runRemediation")
      .mockResolvedValue(makeRun({ state: RunState.AddressingReview }));

    reviewerAgent.run.mockResolvedValue(makeReview());
    githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 555]]));

    const result = await svc.runReview("run-1");

    expect(reviewerAgent.run).toHaveBeenCalledWith(
      plan,
      executionReport,
      "diff content",
      expect.anything(),
      "run-1",
    );
    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.arrayContaining([expect.objectContaining({ id: "f1" })]),
      "changes_requested",
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Changes Requested"),
    );
    expect(store.runState).toBe(RunState.AddressingReview);
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", { f1: 555 });
    expect(result.state).toBe(RunState.AddressingReview);
  });

  it("approved: skips postReviewFindings when there are no findings and delegates to markReady", async () => {
    const executionReport = makeExecutionReport();
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [asArtifact({ type: "ExecutionReport", version: 1, payloadJson: executionReport })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const { deps, reviewerAgent, githubSync, runRepo } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi
      .spyOn(svc, "markReady")
      .mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved", findings: [] }));

    const result = await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { reviewerRuntime: "codex" });
    expect(store.runState).toBe(RunState.ReadyForHumanReview);
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });
});

describe("OrchestratorService.runRemediation", () => {
  it("commits the fix, syncs GitHub, posts comments, and hands off to markReady", async () => {
    const review = makeReview();
    const executionReport = makeExecutionReport({ executionVersion: 1, score: 0.5 });
    const store: TestStore = {
      runState: RunState.AddressingReview,
      artifacts: [
        asArtifact({ type: "Review", version: 1, payloadJson: review }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: executionReport }),
      ],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AddressingReview, branchName: "ai/run-1", prNumber: 42 });
    const { deps, remediationAgent, gitService, githubSync, linearClient, runRepo } = buildDeps(
      store,
      initialRun,
    );
    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi
      .spyOn(svc, "markReady")
      .mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    const newExecutionReport = makeExecutionReport({ executionVersion: 2, score: 0.95 });
    const remediation: Remediation = {
      reviewId: "rev-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "Fixed it", rationale: "Real bug" }],
      readyForHumanReview: true,
      executionReport: newExecutionReport,
    };
    remediationAgent.run.mockResolvedValue(remediation);

    const commentMap = { f1: 555 };
    const result = await svc.runRemediation("run-1", commentMap);

    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("Remediation"),
    );
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { remediationRuntime: "claude-code" });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Execution Report"),
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Remediation Summary"),
    );
    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      42,
      newExecutionReport,
    );
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      remediation.resolution,
      commentMap,
    );
    expect(store.events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining([RunEvent.REMEDIATION_FINISHED, RunEvent.REVIEW_APPROVED]),
    );
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("skips branch checkpoint and GitHub sync when the run has no branchName or PR", async () => {
    const review = makeReview();
    const executionReport = makeExecutionReport();
    const store: TestStore = {
      runState: RunState.AddressingReview,
      artifacts: [
        asArtifact({ type: "Review", version: 1, payloadJson: review }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: executionReport }),
      ],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: null });
    const { deps, remediationAgent, gitService, githubSync } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2 }),
    } satisfies Remediation);

    await svc.runRemediation("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.markReady", () => {
  it("throws PolicyViolationError when there is no Review artifact yet", async () => {
    const executionReport = makeExecutionReport();
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [asArtifact({ type: "ExecutionReport", version: 1, payloadJson: executionReport })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const { deps } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toThrow(PolicyViolationError);
    await expect(svc.markReady("run-1")).rejects.toThrow(/ready_requires_review|without a review/);
  });

  it("posts the completion comment and returns the run when all checks pass", async () => {
    const executionReport = makeExecutionReport();
    const review = makeReview({ overallVerdict: "approved", findings: [] });
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: executionReport }),
        asArtifact({ type: "Review", version: 1, payloadJson: review }),
      ],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const { deps, linearClient } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.markReady("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
    expect(result).toBeDefined();
  });
});
