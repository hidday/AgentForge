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
    state: RunState.AddressingReview,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: "claude-code",
    reviewerRuntime: "codex",
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
    summary: "Implementation done.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "fail", details: "one failing test" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.6,
    scoreRationale: "Needs remediation.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Found a bug",
    findings: [
      { id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "real issue" },
    ],
    overallVerdict: "changes_requested",
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
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };

  const remediationAgent = {
    run: vi.fn().mockImplementation(async (_review: Review, executionReport: ExecutionReport) => {
      const newReport: ExecutionReport = makeExecutionReport({
        executionVersion: executionReport.executionVersion + 1,
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "fixed" },
        },
        score: 0.95,
        scoreRationale: "Fixed.",
      });
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
      await artifactRepo.create({
        runId: store.run.id,
        type: "Remediation",
        version: 1,
        payloadJson: remediation,
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
    remediationAgent,
    gitService,
    githubSync,
    linearClient,
  };
}

describe("OrchestratorService.runRemediation -- policy gating", () => {
  it("throws PolicyViolationError when run is not AddressingReview and never invokes the remediation agent", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.AIReview }),
      artifacts: [asArtifact({ type: "Review", version: 1, payloadJson: makeReview() })],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runRemediation("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("remediate_requires_addressing_review_state");
    expect(built.remediationAgent.run).not.toHaveBeenCalled();
  });

  it("throws PolicyViolationError when there is no Review artifact", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.AddressingReview }),
      artifacts: [],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runRemediation("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("remediate_requires_review");
  });

  it("throws PolicyViolationError when the review verdict is not changes_requested", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.AddressingReview }),
      artifacts: [asArtifact({ type: "Review", version: 1, payloadJson: makeReview({ overallVerdict: "approved" }) })],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runRemediation("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("remediate_requires_changes_requested_verdict");
  });

  it("throws PolicyViolationError when the review has no findings", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.AddressingReview }),
      artifacts: [
        asArtifact({
          type: "Review",
          version: 1,
          payloadJson: makeReview({ overallVerdict: "changes_requested", findings: [] }),
        }),
      ],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runRemediation("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("remediate_requires_findings");
  });
});

describe("OrchestratorService.runRemediation -- happy path structural behaviour", () => {
  function baseStore(overrides: Partial<Run> = {}): TestStore {
    return {
      run: makeRun(overrides),
      artifacts: [
        asArtifact({ type: "Review", version: 1, payloadJson: makeReview() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [],
    };
  }

  it("commits a remediation checkpoint when the run has a branchName", async () => {
    const store = baseStore();
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);

    expect(built.gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(built.gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("Remediation"),
    );
  });

  it("skips the git checkpoint when the run has no branchName", async () => {
    const store = baseStore({ branchName: null });
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);

    expect(built.gitService.assertBranch).not.toHaveBeenCalled();
    expect(built.gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("posts the updated ExecutionReport comment before the remediation summary comment", async () => {
    const store = baseStore();
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);

    const calls = built.linearClient.postComment.mock.calls;
    const executionReportCallIndex = calls.findIndex((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    );
    const remediationSummaryCallIndex = calls.findIndex((c: unknown[]) =>
      (c[1] as string).includes("Remediation Summary"),
    );
    expect(executionReportCallIndex).toBeGreaterThanOrEqual(0);
    expect(remediationSummaryCallIndex).toBeGreaterThan(executionReportCallIndex);
  });

  it("posts execution report update and remediation resolutions to GitHub when a PR exists", async () => {
    const store = baseStore({ prNumber: 42 });
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runRemediation("run-1", { f1: 7 })).rejects.toThrow(PolicyViolationError);

    expect(built.githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.objectContaining({ executionVersion: 2 }),
    );
    expect(built.githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.arrayContaining([expect.objectContaining({ findingId: "f1" })]),
      { f1: 7 },
    );
  });

  it("does not post GitHub updates when there is no PR number", async () => {
    const store = baseStore({ prNumber: null });
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);

    expect(built.githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(built.githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });

  it("persists remediationRuntime and records REMEDIATION_FINISHED then REVIEW_APPROVED events", async () => {
    const store = baseStore();
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);

    expect(built.runRepo.update).toHaveBeenCalledWith("run-1", { remediationRuntime: "claude-code" });
    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    const finishedIdx = eventTypes.indexOf(RunEvent.REMEDIATION_FINISHED);
    const approvedIdx = eventTypes.indexOf(RunEvent.REVIEW_APPROVED);
    expect(finishedIdx).toBeGreaterThanOrEqual(0);
    expect(approvedIdx).toBeGreaterThan(finishedIdx);
  });

  it("passes the pre-remediation ExecutionReport (not the post-remediation one) to the remediation agent", async () => {
    const store = baseStore();
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);

    expect(built.remediationAgent.run).toHaveBeenCalledTimes(1);
    const [, executionReportArg, workingDirArg, runIdArg] = built.remediationAgent.run.mock.calls[0];
    expect((executionReportArg as ExecutionReport).executionVersion).toBe(1);
    expect(workingDirArg).toBe("/tmp/worktree");
    expect(runIdArg).toBe("run-1");
  });
});
