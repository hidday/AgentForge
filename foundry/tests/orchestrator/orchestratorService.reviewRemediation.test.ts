import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
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
    workingDirectory: "/tmp/work",
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

function makeCheck(status: "pass" | "fail" | "skip" = "pass") {
  return { status, details: "" };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Executed",
    filesChanged: ["src/a.ts"],
    checks: { lint: makeCheck(), typecheck: makeCheck(), tests: makeCheck() },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "good",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "review-1",
    summary: "Looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

const issueFixture = {
  id: "LIN-1",
  identifier: "ENG-1",
  title: "Test issue",
  description: "desc",
  branchName: "ai/run-1",
  labels: [] as string[],
  priority: 0,
  url: null,
};

function buildDeps(overrides: Record<string, unknown> = {}, initialRun: Run = makeRun()) {
  let current: Run = initialRun;

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(current)),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, state: RunState) => {
      current = { ...current, state };
      return Promise.resolve(current);
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      current = { ...current, ...patch };
      return Promise.resolve(current);
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      if (type === "Review")
        return Promise.resolve(makeArtifact({ type: "Review", payloadJson: makeReview() }));
      return Promise.resolve(null);
    }),
  };

  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue(issueFixture),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ parent: undefined, blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff --git a/a.ts b/a.ts"),
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
  const reviewerAgent = { run: vi.fn().mockResolvedValue(makeReview()) };
  const remediationAgent = {
    run: vi.fn().mockResolvedValue({
      resolution: [
        { findingId: "f1", status: "accepted", action: "Fixed it", rationale: "was broken" },
      ],
      executionReport: makeExecutionReport({ executionVersion: 2, score: 0.95 }),
    }),
  };

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
    linearClient,
    githubClient,
    githubSync,
    reviewerAgent,
    remediationAgent,
    gitService,
  };
}

describe("OrchestratorService.runReview", () => {
  it("throws via policy when the run is not in AIReview", async () => {
    const { deps } = buildDeps({}, makeRun({ state: RunState.Implementing }));
    const svc = new OrchestratorService(deps as never);
    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("on approved verdict: transitions to REVIEW_APPROVED and calls markReady (no remediation)", async () => {
    const { deps, reviewerAgent } = buildDeps();
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());
    const remediationSpy = vi.spyOn(svc, "runRemediation");

    const run = await svc.runReview("run-1");

    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(remediationSpy).not.toHaveBeenCalled();
    expect(run.state).toBe(RunState.ReadyForHumanReview);
  });

  it("on changes_requested verdict: posts findings, comments, and delegates to runRemediation with the comment map", async () => {
    const { deps, reviewerAgent, githubSync } = buildDeps();
    reviewerAgent.run.mockResolvedValue(
      makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
        ],
      }),
    );
    githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 123]]));
    const svc = new OrchestratorService(deps as never);
    const remediationSpy = vi.spyOn(svc, "runRemediation").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.anything(),
      "changes_requested",
    );
    expect(remediationSpy).toHaveBeenCalledWith("run-1", { f1: 123 });
  });

  // Note: runReview's `run.prNumber ? ... : ""` diff fallback and the
  // `run.prNumber && ...` findings-posting guard cannot be exercised with
  // prNumber falsy — PolicyEngine.assertCanReview (called at the top of
  // runReview) already throws "Cannot review without an existing PR" before
  // either branch is reached, so the falsy side of both is dead code given
  // the current policy. Not covered; not excluded.

  it("does not post review findings to GitHub when the review has no findings", async () => {
    const { deps, githubSync, reviewerAgent } = buildDeps();
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved", findings: [] }));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runRemediation", () => {
  it("throws via policy when review verdict is not changes_requested", async () => {
    const { deps } = buildDeps({}, makeRun({ state: RunState.AddressingReview }));
    const svc = new OrchestratorService(deps as never);
    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("asserts the branch, runs remediation, commits, and marks ready on success", async () => {
    const { deps, artifactRepo, gitService, remediationAgent, linearClient, githubSync } = buildDeps(
      {},
      makeRun({ state: RunState.AddressingReview }),
    );
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: makeReview({
              overallVerdict: "changes_requested",
              findings: [
                { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
              ],
            }),
          }),
        );
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });

    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    const run = await svc.runRemediation("run-1", { f1: 55 });

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/work", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/work",
      "ai/run-1",
      "[AI] Remediation: address review findings",
    );
    expect(remediationAgent.run).toHaveBeenCalled();
    expect(linearClient.postComment).toHaveBeenCalledTimes(2);
    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.objectContaining({ executionVersion: 2 }),
    );
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.anything(),
      { f1: 55 },
    );
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(run.state).toBe(RunState.ReadyForHumanReview);
  });

  it("skips git operations and GitHub sync when the run has no branch or PR", async () => {
    const { deps, artifactRepo, gitService, githubSync } = buildDeps(
      {},
      makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: null }),
    );
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: makeReview({
              overallVerdict: "changes_requested",
              findings: [
                { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
              ],
            }),
          }),
        );
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runRemediation("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });

  it("defaults commentMap to an empty object when not provided", async () => {
    const { deps, artifactRepo, githubSync } = buildDeps(
      {},
      makeRun({ state: RunState.AddressingReview }),
    );
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: makeReview({
              overallVerdict: "changes_requested",
              findings: [
                { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
              ],
            }),
          }),
        );
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runRemediation("run-1");

    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.anything(),
      {},
    );
  });
});

describe("OrchestratorService.markReady", () => {
  it("throws via policy when there is no PR", async () => {
    const { deps } = buildDeps({}, makeRun({ state: RunState.ReadyForHumanReview, prNumber: null }));
    const svc = new OrchestratorService(deps as never);
    await expect(svc.markReady("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("throws via policy when there are unresolved blocker findings", async () => {
    const { deps, artifactRepo } = buildDeps({}, makeRun({ state: RunState.ReadyForHumanReview }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: makeReview({
              findings: [
                { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
              ],
            }),
          }),
        );
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });
    const svc = new OrchestratorService(deps as never);
    await expect(svc.markReady("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("posts the completion comment when all policy checks pass", async () => {
    const { deps, linearClient } = buildDeps({}, makeRun({ state: RunState.ReadyForHumanReview }));
    const svc = new OrchestratorService(deps as never);

    const run = await svc.markReady("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
    expect(run.state).toBe(RunState.ReadyForHumanReview);
  });
});
