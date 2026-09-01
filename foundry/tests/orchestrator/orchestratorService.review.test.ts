import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
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
    summary: "Implementation done.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.95,
    scoreRationale: "All green.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
    summary: "Findings summary",
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
  runState: RunState;
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildDeps(store: TestStore) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...store.run, state: store.runState }),
    ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      store.run = { ...store.run, state: newState };
      return Promise.resolve(store.run);
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      store.run = { ...store.run, ...patch };
      return Promise.resolve(store.run);
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation(
      (params: { runId: string; type: string; version: number; payloadJson: unknown; rawText: string }) => {
        const a = asArtifact({
          type: params.type,
          version: params.version,
          payloadJson: params.payloadJson,
        });
        store.artifacts.push(a);
        return Promise.resolve(a);
      },
    ),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      const latest = matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
      return Promise.resolve(latest);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation(
      (params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
        const e: RunEventRecord = {
          id: `event-${store.events.length}`,
          runId: params.runId,
          eventType: params.eventType,
          source: params.source,
          payloadJson: params.payloadJson ?? {},
          createdAt: new Date(),
        };
        store.events.push(e);
        return Promise.resolve(e);
      },
    ),
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
    postReviewFindings: vi.fn().mockResolvedValue(new Map([["f1", 555]])),
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
    logger,
    dashboardEmitter,
  };
}

describe("OrchestratorService.runReview", () => {
  it("approved verdict with findings: posts PR review findings, transitions to ReadyForHumanReview, and markReady posts the final comment", async () => {
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const store: TestStore = {
      runState: RunState.AIReview,
      run: initialRun,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [],
    };

    const built = buildDeps(store);
    const approvedReview = makeReview({
      overallVerdict: "approved",
      findings: [
        {
          id: "f1",
          severity: "nit",
          type: "style",
          file: "src/foo.ts",
          title: "Minor nit",
          details: "Consider renaming",
        },
      ],
    });
    // Mirror the real ReviewerAgent, which persists its own Review artifact
    // before returning -- markReady's assertCanMarkReady reads it back.
    built.reviewerAgent.run.mockImplementation(async () => {
      await built.artifactRepo.create({
        runId: "run-1",
        type: "Review",
        version: 1,
        payloadJson: approvedReview,
        rawText: JSON.stringify(approvedReview),
      });
      return approvedReview;
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runReview("run-1");

    expect(built.githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 42);
    expect(built.githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.arrayContaining([expect.objectContaining({ id: "f1" })]),
      "approved",
    );

    expect(store.events.map((e) => e.eventType)).toContain(RunEvent.REVIEW_APPROVED);
    expect(result.state).toBe(RunState.ReadyForHumanReview);

    const readyComment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Ready for Human Review"),
    );
    expect(readyComment).toBeDefined();
  });

  it("changes_requested verdict: posts a code review comment and delegates to runRemediation with the finding->comment map", async () => {
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const store: TestStore = {
      runState: RunState.AIReview,
      run: initialRun,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [],
    };

    const built = buildDeps(store);
    built.reviewerAgent.run.mockResolvedValue(
      makeReview({
        overallVerdict: "changes_requested",
        summary: "Needs work",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "bug",
            file: "src/foo.ts",
            lineHint: 10,
            title: "Off-by-one",
            details: "Loop bound wrong",
          },
        ],
      }),
    );

    const svc = new OrchestratorService(built.deps as never);

    // Isolate runReview's own logic from runRemediation's implementation
    // (already covered by orchestratorService.executionScore.test.ts).
    const remediationSpy = vi
      .spyOn(svc, "runRemediation")
      .mockResolvedValue({ ...store.run, state: RunState.AddressingReview });

    const result = await svc.runReview("run-1");

    // formatCodeReviewComment output posted to Linear
    const codeReviewComment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("AI Code Review"),
    );
    expect(codeReviewComment).toBeDefined();
    expect(codeReviewComment![1]).toContain("Changes Requested");
    expect(codeReviewComment![1]).toContain("Off-by-one");
    expect(codeReviewComment![1]).toContain("src/foo.ts:10");

    expect(store.events.map((e) => e.eventType)).toContain(RunEvent.REVIEW_CHANGES_REQUESTED);

    expect(remediationSpy).toHaveBeenCalledWith("run-1", { f1: 555 });
    expect(result.state).toBe(RunState.AddressingReview);
  });

  it("skips getPRDiff and postReviewFindings when the run has no prNumber", async () => {
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: null });
    const store: TestStore = {
      runState: RunState.AIReview,
      run: initialRun,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [],
    };

    const built = buildDeps(store);
    built.reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(built.deps as never);

    // assertCanReview requires a prNumber, so this branch must throw before
    // ever reaching the diff/postReviewFindings calls.
    await expect(svc.runReview("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
    expect(built.githubClient.getPRDiff).not.toHaveBeenCalled();
  });

  it("throws PolicyViolationError via assertCanReview when run is not in AIReview state", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, prNumber: 42 });
    const store: TestStore = {
      runState: RunState.Implementing,
      run: initialRun,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [],
    };

    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runReview("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
    expect(built.reviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runRemediation branch coverage", () => {
  it("skips git assertBranch when the run has no branchName and skips GitHub sync when there is no prNumber", async () => {
    const initialRun = makeRun({
      state: RunState.AddressingReview,
      branchName: null,
      prNumber: null,
    });
    const store: TestStore = {
      runState: RunState.AddressingReview,
      run: initialRun,
      artifacts: [
        asArtifact({
          type: "Review",
          version: 1,
          payloadJson: makeReview({
            overallVerdict: "changes_requested",
            findings: [
              {
                id: "f1",
                severity: "important",
                type: "bug",
                file: "src/foo.ts",
                title: "Bug",
                details: "Real issue",
              },
            ],
          }),
        }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [],
    };

    const built = buildDeps(store);
    const { gitService } = built.deps as unknown as {
      gitService: { assertBranch: ReturnType<typeof vi.fn>; commitAndPush: ReturnType<typeof vi.fn> };
    };

    built.deps.remediationAgent.run = vi.fn().mockImplementation(async () => {
      const newReport = makeExecutionReport({ executionVersion: 2, score: 0.9 });
      return {
        reviewId: "rev-001",
        resolution: [
          { findingId: "f1", status: "accepted", action: "Fixed", rationale: "done" },
        ],
        readyForHumanReview: true,
        executionReport: newReport,
      };
    });

    const svc = new OrchestratorService(built.deps as never);

    // markReady will still fail the policy check (no prNumber), which is
    // expected and orthogonal to what this test verifies.
    await expect(svc.runRemediation("run-1")).rejects.toBeInstanceOf(PolicyViolationError);

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
    expect(built.githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(built.githubSync.postRemediationResolutions).not.toHaveBeenCalled();

    // Both remediation comments were still posted to Linear.
    const remediationComment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Remediation Summary"),
    );
    expect(remediationComment).toBeDefined();
  });

  it("throws PolicyViolationError via assertCanRemediate when run is not in AddressingReview state", async () => {
    const initialRun = makeRun({ state: RunState.AIReview });
    const store: TestStore = {
      runState: RunState.AIReview,
      run: initialRun,
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

    await expect(svc.runRemediation("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
    expect(built.deps.remediationAgent.run).not.toHaveBeenCalled();
  });
});
