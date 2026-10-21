import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
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
    summary: "Implementation complete.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "all green" },
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
    reviewId: "rev-001",
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

interface TestStore {
  runState: RunState;
  artifacts: Artifact[];
  events: { id: string; runId: string; eventType: string; source: string; createdAt: Date }[];
}

function buildDeps(store: TestStore, initialRun: Run) {
  let eventCounter = 0;

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
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      Object.assign(initialRun, patch);
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
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string }) => {
      eventCounter += 1;
      const evt = {
        id: `event-${eventCounter}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        createdAt: new Date(Date.now() + eventCounter),
      };
      store.events.push(evt);
      return Promise.resolve(evt);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "LIN-1",
      title: "Test issue",
      description: "desc",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
      state: "Todo",
      url: "https://linear.app/x",
      project: "proj",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ parent: null, blockers: [] }),
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
    postReviewFindings: vi.fn().mockResolvedValue(new Map([["f1", 123]])),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  // Mirrors the real ExecutorAgent, which persists its own ExecutionReport artifact.
  const executorAgent = {
    run: vi.fn().mockImplementation(async () => {
      const report = makeExecutionReport();
      await artifactRepo.create({
        runId: "run-1",
        type: "ExecutionReport",
        version: report.executionVersion,
        payloadJson: report,
        rawText: JSON.stringify(report),
      });
      return { report, prNumber: 42 };
    }),
  };

  // Mirrors the real ReviewerAgent, which persists its own Review artifact.
  const reviewVerdict = { current: makeReview() };
  const reviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const review = reviewVerdict.current;
      await artifactRepo.create({
        runId: "run-1",
        type: "Review",
        version: 1,
        payloadJson: review,
        rawText: JSON.stringify(review),
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
    executorAgent,
    reviewerAgent,
    remediationAgent,
    githubSync,
    linearClient,
    gitService,
    reviewVerdict,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("getters expose the injected repositories/clients", () => {
    const store: TestStore = { runState: RunState.Implementing, artifacts: [], events: [] };
    const built = buildDeps(store, makeRun());
    const svc = new OrchestratorService(built.deps as never);
    expect(svc.getRunRepo()).toBe(built.runRepo);
    expect(svc.getArtifactRepo()).toBe(built.artifactRepo);
    expect(svc.getEventRepo()).toBe(built.eventRepo);
    expect(svc.getAgentSkillRepo()).toBeUndefined();
    expect(svc.getLinearClient()).toBe(built.linearClient);
  });

  it("happy path: runs the executor, transitions to AIReview, posts a comment, and starts review", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing });
    const built = buildDeps(store, initialRun);
    built.reviewVerdict.current = makeReview({ overallVerdict: "approved" });
    const svc = new OrchestratorService(built.deps as never);

    const run = await svc.runExecution("run-1");

    expect(built.executorAgent.run).toHaveBeenCalledTimes(1);
    expect(built.gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      "[AI] WIP: checkpoint before executor run",
    );
    // Chains into runReview -> approved -> markReady, ending at ReadyForHumanReview.
    expect(run.state).toBe(RunState.ReadyForHumanReview);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Execution Report"),
    );
  });

  it("skips the checkpoint commit when the run has no branchName yet", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing, branchName: null });
    const built = buildDeps(store, initialRun);
    built.reviewVerdict.current = makeReview({ overallVerdict: "approved" });
    const svc = new OrchestratorService(built.deps as never);

    await svc.runExecution("run-1");

    expect(built.gitService.commitAndPush).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "[AI] WIP: checkpoint before executor run",
    );
  });

  it("recovers a stranded execution (ExecutionReport exists, EXECUTION_FINISHED never recorded) without re-running the executor", async () => {
    const earlier = new Date("2024-01-01T00:00:00Z");
    const later = new Date("2024-01-01T00:05:00Z");
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({
          type: "ExecutionReport",
          version: 1,
          payloadJson: makeExecutionReport(),
          createdAt: later,
        }),
      ],
      events: [
        {
          id: "evt-started",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_STARTED,
          source: "orchestrator",
          createdAt: earlier,
        },
      ],
    };
    const initialRun = makeRun({ state: RunState.Implementing, prNumber: 42 });
    const built = buildDeps(store, initialRun);
    built.reviewVerdict.current = makeReview({ overallVerdict: "approved" });
    const svc = new OrchestratorService(built.deps as never);

    const run = await svc.runExecution("run-1");

    expect(built.executorAgent.run).not.toHaveBeenCalled();
    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);
    expect(run.state).toBe(RunState.ReadyForHumanReview);
  });

  it("pauses the run and posts a comment when the executor times out", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing });
    const built = buildDeps(store, initialRun);
    built.executorAgent.run.mockRejectedValue(
      new AgentTimeoutError("executor", 600_000),
    );
    const svc = new OrchestratorService(built.deps as never);

    const run = await svc.runExecution("run-1");

    expect(run.state).toBe(RunState.AIBlocked);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Executor timed out"),
    );
    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain("EXECUTION_TIMEOUT");
  });

  it("rethrows non-timeout executor errors without transitioning the run", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store, makeRun({ state: RunState.Implementing }));
    built.executorAgent.run.mockRejectedValue(new Error("executor crashed"));
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("executor crashed");
    expect(store.runState).toBe(RunState.Implementing);
  });
});

describe("OrchestratorService.runReview", () => {
  it("approved verdict transitions to ReadyForHumanReview via markReady", async () => {
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [],
    };
    const built = buildDeps(store, makeRun({ state: RunState.AIReview }));
    built.reviewVerdict.current = makeReview({ overallVerdict: "approved" });
    const svc = new OrchestratorService(built.deps as never);

    const run = await svc.runReview("run-1");

    expect(run.state).toBe(RunState.ReadyForHumanReview);
    expect(built.githubSync.postReviewFindings).not.toHaveBeenCalled();
  });

  it("changes_requested verdict with PR findings posts review comments and starts remediation", async () => {
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [],
    };
    const built = buildDeps(store, makeRun({ state: RunState.AIReview, prNumber: 42 }));
    built.reviewVerdict.current = makeReview({
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
    });
    // runRemediation will run for real; give it what it needs to complete.
    built.remediationAgent.run.mockImplementation(
      async (_review: unknown, executionReport: ExecutionReport) => {
        const newReport = makeExecutionReport({ executionVersion: executionReport.executionVersion + 1 });
        await built.artifactRepo.create({
          runId: "run-1",
          type: "ExecutionReport",
          version: newReport.executionVersion,
          payloadJson: newReport,
          rawText: "{}",
        });
        return {
          reviewId: "rev-001",
          resolution: [
            { findingId: "f1", status: "accepted", action: "Fixed", rationale: "real bug" },
          ],
          readyForHumanReview: true,
          executionReport: newReport,
        };
      },
    );
    const svc = new OrchestratorService(built.deps as never);

    // markReady (chained via runRemediation) is expected to throw on the
    // *verdict* check: remediation doesn't re-trigger review, so the latest
    // Review artifact still reads "changes_requested" (see the identical,
    // pre-existing limitation documented in orchestratorService.executionScore.test.ts).
    // We assert the review/remediation side effects happened correctly up to
    // that known point, same as that sibling test does.
    await expect(svc.runReview("run-1")).rejects.toThrow(
      /Cannot mark ready when latest review verdict is "changes_requested"/,
    );

    expect(built.githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.any(Array),
      "changes_requested",
    );
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("AI Code Review"),
    );
    expect(built.remediationAgent.run).toHaveBeenCalledTimes(1);
    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.REVIEW_CHANGES_REQUESTED);
    expect(eventTypes).toContain(RunEvent.REMEDIATION_FINISHED);
  });

  it("refuses to review a run with no PR yet (policy guard runs before the reviewer agent)", async () => {
    const store: TestStore = {
      runState: RunState.AIReview,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
      events: [],
    };
    const built = buildDeps(store, makeRun({ state: RunState.AIReview, prNumber: null }));
    built.reviewVerdict.current = makeReview({ overallVerdict: "approved" });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runReview("run-1")).rejects.toThrow(
      /Cannot review without an existing PR/,
    );
    expect(built.reviewerAgent.run).not.toHaveBeenCalled();
  });
});
