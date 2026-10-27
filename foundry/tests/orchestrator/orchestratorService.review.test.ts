import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

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
    prNumber: 10,
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
    scoreRationale: "Looks solid.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Found stuff",
    findings: [],
    overallVerdict: "approved",
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

function buildDeps() {
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
    findLatestByType: vi.fn(),
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
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff"),
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
    githubSync,
    reviewerAgent,
    remediationAgent,
  };
}

describe("OrchestratorService.runReview -- policy guards", () => {
  it("throws when the run is not in AIReview state", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "ExecutionReport"
        ? Promise.resolve(asArtifact("ExecutionReport", 1, makeExecutionReport()))
        : Promise.resolve(null),
    );

    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("throws when there is no PR", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: null }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "ExecutionReport"
        ? Promise.resolve(asArtifact("ExecutionReport", 1, makeExecutionReport()))
        : Promise.resolve(null),
    );

    try {
      await svc.runReview("run-1");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
    }
  });

  it("throws when there is no execution report", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 10 }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    try {
      await svc.runReview("run-1");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
    }
  });
});

describe("OrchestratorService.runReview -- verdict routing", () => {
  it("routes to runRemediation when the reviewer requests changes", async () => {
    const { deps, runRepo, artifactRepo, linearClient, githubSync, reviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AIReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue(run);

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(asArtifact("ExecutionReport", 1, makeExecutionReport()));
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      return Promise.resolve(null);
    });

    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
      ],
    });
    reviewerAgent.run.mockResolvedValue(review);

    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));

    const remediationSpy = vi
      .spyOn(svc, "runRemediation")
      .mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      run.repo,
      run.prNumber,
      review.findings,
      "changes_requested",
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Changes Requested"),
    );
    expect(remediationSpy).toHaveBeenCalledWith("run-1", expect.any(Object));
  });

  it("routes to markReady when the reviewer approves", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AIReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue(run);

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(asArtifact("ExecutionReport", 1, makeExecutionReport()));
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      return Promise.resolve(null);
    });

    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved", findings: [] }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    const markReadySpy = vi
      .spyOn(svc, "markReady")
      .mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    await svc.runReview("run-1");

    // No findings posted when there are none
    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
  });

  it("does not post review findings to GitHub when there is no PR number", async () => {
    const { deps, runRepo, artifactRepo, githubSync, reviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    // AIReview requires a prNumber per policy, so give it one for the initial
    // check but then have the run come back without one after `update`.
    const run = makeRun({ state: RunState.AIReview, prNumber: 10 });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, prNumber: null });

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(asArtifact("ExecutionReport", 1, makeExecutionReport()));
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      return Promise.resolve(null);
    });

    reviewerAgent.run.mockResolvedValue(
      makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "nit", type: "style", file: "a.ts", title: "t", details: "d" },
        ],
      }),
    );
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));
    vi.spyOn(svc, "runRemediation").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runRemediation -- policy guards", () => {
  it("throws when the run is not in AddressingReview state", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Review"
        ? Promise.resolve(
            asArtifact(
              "Review",
              1,
              makeReview({
                overallVerdict: "changes_requested",
                findings: [
                  { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
                ],
              }),
            ),
          )
        : Promise.resolve(null),
    );

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("throws when there is no review artifact", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    try {
      await svc.runRemediation("run-1");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
    }
  });

  it("throws when the review verdict is not changes_requested", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Review"
        ? Promise.resolve(asArtifact("Review", 1, makeReview({ overallVerdict: "approved" })))
        : Promise.resolve(null),
    );

    try {
      await svc.runRemediation("run-1");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe(
        "remediate_requires_changes_requested_verdict",
      );
    }
  });
});

describe("OrchestratorService.runRemediation -- happy path", () => {
  it("asserts the branch, commits, posts comments, and marks ready", async () => {
    const { deps, runRepo, artifactRepo, linearClient, githubSync, remediationAgent } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AddressingReview, branchName: "ai/run-1" });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue(run);

    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
      ],
    });
    const executionReport = makeExecutionReport();
    const newExecutionReport = makeExecutionReport({ executionVersion: 2, score: 0.95 });

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Review") return Promise.resolve(asArtifact("Review", 1, review));
      if (type === "ExecutionReport")
        return Promise.resolve(asArtifact("ExecutionReport", 1, executionReport));
      return Promise.resolve(null);
    });

    remediationAgent.run.mockResolvedValue({
      reviewId: review.reviewId,
      resolution: [
        { findingId: "f1", status: "accepted", action: "Fixed", rationale: "Real issue" },
      ],
      readyForHumanReview: true,
      executionReport: newExecutionReport,
    });

    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    const markReadySpy = vi
      .spyOn(svc, "markReady")
      .mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    const result = await svc.runRemediation("run-1", { "f1-fallback": 1 });

    expect(deps.gitService.assertBranch).toHaveBeenCalledWith(run.workingDirectory, "ai/run-1");
    expect(deps.gitService.commitAndPush).toHaveBeenCalledWith(
      run.workingDirectory,
      "ai/run-1",
      expect.stringContaining("Remediation"),
    );
    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      run.repo,
      run.prNumber,
      newExecutionReport,
    );
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      run.repo,
      run.prNumber,
      expect.any(Array),
      { "f1-fallback": 1 },
    );
    expect(linearClient.postComment).toHaveBeenCalledTimes(2);
    expect(markReadySpy).toHaveBeenCalledWith("run-1");

    const eventTypes = (deps.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.REMEDIATION_FINISHED);
    expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);
    expect(result).toBeDefined();
  });

  it("skips git operations when the run has no branch name", async () => {
    const { deps, runRepo, artifactRepo, githubSync, remediationAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: null });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue(run);

    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
      ],
    });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Review") return Promise.resolve(asArtifact("Review", 1, review));
      if (type === "ExecutionReport")
        return Promise.resolve(asArtifact("ExecutionReport", 1, makeExecutionReport()));
      return Promise.resolve(null);
    });

    remediationAgent.run.mockResolvedValue({
      reviewId: review.reviewId,
      resolution: [],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2 }),
    });

    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: null }));
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    await svc.runRemediation("run-1");

    expect(deps.gitService.assertBranch).not.toHaveBeenCalled();
    expect(deps.gitService.commitAndPush).not.toHaveBeenCalled();
    // No PR, so GitHub sync calls for execution report / resolutions should not fire.
    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.markReady -- policy guards", () => {
  it("throws when there is no PR", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ prNumber: null }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    try {
      await svc.markReady("run-1");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
    }
  });

  it("throws when the latest review has unresolved blocker findings", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ prNumber: 10 }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(asArtifact("ExecutionReport", 1, makeExecutionReport()));
      if (type === "Review")
        return Promise.resolve(
          asArtifact(
            "Review",
            1,
            makeReview({
              overallVerdict: "approved",
              findings: [
                { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
              ],
            }),
          ),
        );
      return Promise.resolve(null);
    });

    try {
      await svc.markReady("run-1");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
    }
  });

  it("posts the completion comment when all gates pass", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ prNumber: 10 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(asArtifact("ExecutionReport", 1, makeExecutionReport()));
      if (type === "Review")
        return Promise.resolve(
          asArtifact("Review", 1, makeReview({ overallVerdict: "approved", findings: [] })),
        );
      return Promise.resolve(null);
    });

    const result = await svc.markReady("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Ready for Human Review"),
    );
    expect(result).toBeDefined();
  });
});
