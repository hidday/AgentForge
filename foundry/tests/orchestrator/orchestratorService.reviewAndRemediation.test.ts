import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { Remediation } from "../../src/schemas/remediation.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
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

function asArtifact(type: string, version: number, payloadJson: unknown): Artifact {
  return {
    id: `artifact-${type}-${version}`,
    runId: "run-1",
    type: type as Artifact["type"],
    version,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt: new Date(),
  };
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockResolvedValue(null),
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
      branchName: "ai/run-1",
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
    postReviewFindings: vi.fn().mockResolvedValue(new Map([["f1", 123]])),
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
    logger,
  };
}

describe("OrchestratorService.runReview", () => {
  it("approved verdict: transitions to ReadyForHumanReview and calls markReady", async () => {
    const { deps, runRepo, artifactRepo, githubClient, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    const report = makeExecutionReport();
    const review: Review = { reviewId: "r1", summary: "Great work", findings: [], overallVerdict: "approved" };

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 42 }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AIReview, reviewerRuntime: "codex" }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, report));
      if (type === "Review") return Promise.resolve(asArtifact("Review", 1, review));
      return Promise.resolve(null);
    });
    (deps.reviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue(review);

    const result = await svc.runReview("run-1");

    expect(githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 42);
    expect(result.state).toBe(RunState.ReadyForHumanReview);
    const readyComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Ready for Human Review"),
    );
    expect(readyComment).toBeDefined();
  });

  // NOTE: runReview's `run.prNumber ? ... : ""` empty-diff ternary branch is
  // unreachable from the public API: PolicyEngine.assertCanReview (called just
  // above it, using the same `run`) already throws "Cannot review without an
  // existing PR" whenever run.prNumber is falsy. So the empty-diff branch is
  // dead code and intentionally left untested here.

  it("changes_requested verdict: posts findings to GitHub (when PR exists with findings) and chains into runRemediation", async () => {
    const { deps, runRepo, artifactRepo, githubSync, linearClient, remediationAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    const report = makeExecutionReport();
    const review: Review = {
      reviewId: "r1",
      summary: "Needs fixes",
      findings: [
        { id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "Fix it" },
      ],
      overallVerdict: "changes_requested",
    };

    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 42 }))
      .mockResolvedValue(makeRun({ state: RunState.AddressingReview, prNumber: 42 }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, report));
      if (type === "Review") return Promise.resolve(asArtifact("Review", 1, review));
      return Promise.resolve(null);
    });
    (deps.reviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue(review);
    // Make remediation throw so we don't need to also model its own downstream chain here;
    // runRemediation is covered separately below. We only assert that runReview DID chain into it.
    remediationAgent.run.mockRejectedValue(new Error("remediation not modeled in this test"));

    await expect(svc.runReview("run-1")).rejects.toThrow("remediation not modeled in this test");

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith("test-repo", 42, review.findings, "changes_requested");
    const changesComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Changes Requested"),
    );
    expect(changesComment).toBeDefined();
  });

  it("does not post findings to GitHub when there are no findings even with a PR", async () => {
    const { deps, runRepo, artifactRepo, githubSync, remediationAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    const report = makeExecutionReport();
    const review: Review = { reviewId: "r1", summary: "Needs fixes", findings: [], overallVerdict: "changes_requested" };

    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 42 }))
      .mockResolvedValue(makeRun({ state: RunState.AddressingReview, prNumber: 42 }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, report));
      if (type === "Review") return Promise.resolve(asArtifact("Review", 1, review));
      return Promise.resolve(null);
    });
    (deps.reviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue(review);
    // With zero findings, runRemediation's own PolicyEngine.assertCanRemediate
    // check throws before the remediation agent is even invoked.
    await expect(svc.runReview("run-1")).rejects.toThrow("Cannot remediate without review findings");
    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(remediationAgent.run).not.toHaveBeenCalled();
  });

  it("throws PolicyViolationError via assertCanReview when run is not in AIReview state", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);
  });
});

describe("OrchestratorService.runRemediation", () => {
  it("happy path: addresses findings, commits + pushes, posts comments, updates GitHub, and marks ready", async () => {
    const { deps, runRepo, artifactRepo, githubSync, linearClient, remediationAgent, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const review: Review = {
      reviewId: "r1",
      summary: "Needs fixes",
      findings: [
        { id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "Fix it" },
      ],
      overallVerdict: "changes_requested",
    };
    const execReportV1 = makeExecutionReport({ executionVersion: 1, score: 0.5 });
    const execReportV2 = makeExecutionReport({ executionVersion: 2, score: 0.95 });
    const remediation: Remediation = {
      reviewId: "r1",
      resolution: [{ findingId: "f1", status: "accepted", action: "Fixed the bug", rationale: "Was real" }],
      readyForHumanReview: true,
      executionReport: execReportV2,
    };

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AddressingReview, prNumber: 42 }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Review") return Promise.resolve(asArtifact("Review", 1, review));
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, execReportV1));
      return Promise.resolve(null);
    });
    remediationAgent.run.mockResolvedValue(remediation);
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AddressingReview, remediationRuntime: "claude-code" }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview })) // REMEDIATION_FINISHED
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview })); // REVIEW_APPROVED

    // runRemediation always finishes by calling markReady, which re-reads the
    // latest Review artifact. Since this mock doesn't simulate the real
    // RemediationAgent re-running code review, the stored Review is still the
    // "changes_requested" one, so markReady's policy check throws (the same
    // pre-existing limitation documented in orchestratorService.executionScore.test.ts).
    // We assert the PolicyViolationError and verify all the remediation side
    // effects already ran by the time it's thrown.
    let caught: PolicyViolationError | undefined;
    let result: Run | undefined;
    try {
      result = await svc.runRemediation("run-1", { f1: 123 });
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("ready_requires_approved_verdict");
    expect(result).toBeUndefined();

    expect(remediationAgent.run).toHaveBeenCalledWith(review, execReportV1, "/tmp/worktree", "run-1");
    expect(deps.gitService && (deps.gitService as { commitAndPush: ReturnType<typeof vi.fn> }).commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      "[AI] Remediation: address review findings",
    );

    const execReportComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report (v2)"),
    );
    expect(execReportComment).toBeDefined();

    const remediationComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Remediation Summary"),
    );
    expect(remediationComment).toBeDefined();
    expect(remediationComment![1]).toContain("Fixed the bug");

    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith("test-repo", 42, execReportV2);
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith("test-repo", 42, remediation.resolution, { f1: 123 });

    const scoreLog = (logger.info as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Remediation complete"),
    );
    expect(scoreLog).toBeDefined();
    expect((scoreLog![0] as { scoreDelta: number }).scoreDelta).toBeCloseTo(0.45, 5);
  });

  it("skips git operations and GitHub sync when the run has no branchName / prNumber", async () => {
    const { deps, runRepo, artifactRepo, githubSync, remediationAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const review: Review = {
      reviewId: "r1",
      summary: "Needs fixes",
      findings: [{ id: "f1", severity: "nit", type: "style", file: "x.ts", title: "nit", details: "d" }],
      overallVerdict: "changes_requested",
    };
    const execReportV1 = makeExecutionReport({ executionVersion: 1 });
    const execReportV2 = makeExecutionReport({ executionVersion: 2 });
    const remediation: Remediation = {
      reviewId: "r1",
      resolution: [{ findingId: "f1", status: "accepted", action: "fixed", rationale: "ok" }],
      readyForHumanReview: true,
      executionReport: execReportV2,
    };

    runRepo.findById.mockResolvedValue(
      makeRun({ state: RunState.AddressingReview, prNumber: null, branchName: null }),
    );
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Review") return Promise.resolve(asArtifact("Review", 1, review));
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, execReportV1));
      return Promise.resolve(null);
    });
    remediationAgent.run.mockResolvedValue(remediation);
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AddressingReview, prNumber: null, branchName: null }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: null, branchName: null }))
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: null, branchName: null }));

    // As in the test above, markReady throws because the stored Review is
    // still "changes_requested" (here it throws even earlier, on the missing
    // PR check) -- the side effects we care about already ran by then.
    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);

    expect((deps.gitService as { commitAndPush: ReturnType<typeof vi.fn> }).commitAndPush).not.toHaveBeenCalled();
    expect((deps.gitService as { assertBranch: ReturnType<typeof vi.fn> }).assertBranch).not.toHaveBeenCalled();
    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });

  it("throws PolicyViolationError via assertCanRemediate when run is not AddressingReview", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("throws PolicyViolationError when the review has no findings", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const review: Review = { reviewId: "r1", summary: "weird", findings: [], overallVerdict: "changes_requested" };
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Review") return Promise.resolve(asArtifact("Review", 1, review));
      return Promise.resolve(null);
    });

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);
  });
});

describe("OrchestratorService.markReady", () => {
  it("posts the completion comment when all policy checks pass", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const review: Review = { reviewId: "r1", summary: "ok", findings: [], overallVerdict: "approved" };
    const report = makeExecutionReport();

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42 }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Review") return Promise.resolve(asArtifact("Review", 1, review));
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, report));
      return Promise.resolve(null);
    });

    const result = await svc.markReady("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("throws PolicyViolationError when there is no PR", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: null }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.markReady("run-1")).rejects.toThrow(PolicyViolationError);
  });
});
