import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
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
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks solid.",
    ...overrides,
  };
}

function asArtifact(o: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${o.type}-${o.version}-${Math.random().toString(36).slice(2, 7)}`,
    runId: "run-1",
    type: o.type as Artifact["type"],
    version: o.version,
    payloadJson: o.payloadJson,
    rawText: JSON.stringify(o.payloadJson),
    createdAt: new Date(),
  };
}

interface Store {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildDeps(store: Store, overrides: Record<string, unknown> = {}) {
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
    update: vi.fn().mockImplementation((_id: string, data: Partial<Run>) => {
      store.run = { ...store.run, ...data };
      return Promise.resolve({ ...store.run });
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
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const e: RunEventRecord = {
        id: `evt-${store.events.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(e);
      return Promise.resolve(e);
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

  const githubClient = { getPRDiff: vi.fn().mockResolvedValue("diff content"), getDefaultBranch: vi.fn().mockResolvedValue("main") };

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
      ...overrides,
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

describe("OrchestratorService.runReview", () => {
  it("throws via policy when there is no PR number", async () => {
    const report = makeExecutionReport();
    const store: Store = {
      run: makeRun({ prNumber: null }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
      ],
      events: [],
    };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("fetches the PR diff via githubClient using the run's repo and PR number", async () => {
    const report = makeExecutionReport();
    const store: Store = {
      run: makeRun({ prNumber: 42 }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
      ],
      events: [],
    };
    const { deps, githubClient, reviewerAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);
    reviewerAgent.run.mockImplementation(() => {
      const review = { reviewId: "r1", summary: "ok", findings: [], overallVerdict: "approved" };
      store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
      return Promise.resolve(review);
    });

    await svc.runReview("run-1");

    expect(githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 42);
  });

  it("approved verdict: transitions to ReadyForHumanReview and calls markReady", async () => {
    const report = makeExecutionReport();
    const store: Store = {
      run: makeRun(),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
      ],
      events: [],
    };
    const { deps, reviewerAgent, eventRepo, linearClient } = buildDeps(store);
    reviewerAgent.run.mockImplementation(() => {
      const review = { reviewId: "r1", summary: "All good", findings: [], overallVerdict: "approved" };
      store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
      return Promise.resolve(review);
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runReview("run-1");

    expect(store.run.reviewerRuntime).toBe("codex");
    const eventTypes = eventRepo.create.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("changes_requested verdict with findings: posts PR review findings, transitions to AddressingReview, and delegates to runRemediation", async () => {
    const report = makeExecutionReport();
    const store: Store = {
      run: makeRun(),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
      ],
      events: [],
    };
    const { deps, reviewerAgent, githubSync, eventRepo, linearClient, remediationAgent } = buildDeps(store);
    const finding = { id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "oops" };
    reviewerAgent.run.mockImplementation(() => {
      const review = {
        reviewId: "r1",
        summary: "Found issues",
        findings: [finding],
        overallVerdict: "changes_requested",
      };
      store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
      return Promise.resolve(review);
    });
    githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 555]]));
    remediationAgent.run.mockImplementation(() => {
      const newReport = makeExecutionReport({ executionVersion: 2 });
      const remediation = {
        reviewId: "r1",
        resolution: [{ findingId: "f1", status: "accepted", action: "fixed", rationale: "real bug" }],
        readyForHumanReview: true,
        executionReport: newReport,
      };
      store.artifacts.push(asArtifact({ type: "ExecutionReport", version: 2, payloadJson: newReport }));
      store.artifacts.push(asArtifact({ type: "Remediation", version: 1, payloadJson: remediation }));
      return Promise.resolve(remediation);
    });
    const svc = new OrchestratorService(deps as never);

    // Pre-existing (out of scope) behavior: runRemediation's final markReady()
    // re-reads the latest Review artifact, which is still the changes_requested
    // one from this pass (remediation does not re-run code review), so
    // assertCanMarkReady rejects on the verdict check. We assert on everything
    // that happens up to that point, which is what this test targets.
    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      42,
      [finding],
      "changes_requested",
    );
    const eventTypes = eventRepo.create.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain(RunEvent.REVIEW_CHANGES_REQUESTED);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Changes Requested"),
    );
    expect(remediationAgent.run).toHaveBeenCalled();
    // commentMap derived from the Map should have been threaded into remediation.
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.anything(),
      { f1: 555 },
    );
  });

  it("changes_requested verdict: when remediation's follow-up Review artifact is approved, runRemediation completes and markReady succeeds", async () => {
    // This exercises the normal (non-throwing) completion tail of runRemediation
    // and markReady, which the "pre-existing" test above cannot reach because
    // the latest Review stays changes_requested. Here we simulate a Review
    // artifact landing as approved by the time markReady re-reads it.
    const report = makeExecutionReport();
    const store: Store = {
      run: makeRun(),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
      ],
      events: [],
    };
    const { deps, reviewerAgent, remediationAgent, linearClient } = buildDeps(store);
    const finding = { id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "oops" };
    reviewerAgent.run.mockImplementation(() => {
      const review = {
        reviewId: "r1",
        summary: "Found issues",
        findings: [finding],
        overallVerdict: "changes_requested",
      };
      store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
      return Promise.resolve(review);
    });
    remediationAgent.run.mockImplementation(() => {
      const newReport = makeExecutionReport({ executionVersion: 2 });
      const remediation = {
        reviewId: "r1",
        resolution: [{ findingId: "f1", status: "accepted", action: "fixed", rationale: "real bug" }],
        readyForHumanReview: true,
        executionReport: newReport,
      };
      store.artifacts.push(asArtifact({ type: "ExecutionReport", version: 2, payloadJson: newReport }));
      store.artifacts.push(asArtifact({ type: "Remediation", version: 1, payloadJson: remediation }));
      // Simulate the finding being resolved and the review re-approved.
      store.artifacts.push(
        asArtifact({
          type: "Review",
          version: 2,
          payloadJson: { reviewId: "r1", summary: "Resolved", findings: [], overallVerdict: "approved" },
        }),
      );
      return Promise.resolve(remediation);
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runReview("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("changes_requested verdict with no findings: does not call postReviewFindings", async () => {
    const report = makeExecutionReport();
    const store: Store = {
      run: makeRun(),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }),
      ],
      events: [],
    };
    const { deps, reviewerAgent, githubSync, remediationAgent } = buildDeps(store);
    reviewerAgent.run.mockImplementation(() => {
      const review = { reviewId: "r1", summary: "Vague issues", findings: [], overallVerdict: "changes_requested" };
      store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
      return Promise.resolve(review);
    });
    remediationAgent.run.mockImplementation(() => {
      throw new PolicyViolationError("Cannot remediate without review findings", "remediate_requires_findings");
    });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runReview("run-1")).rejects.toThrow(/findings/);
    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
  });
});
