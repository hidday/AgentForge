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

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Review summary",
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
    findLatestByType: vi.fn(),
  };

  const eventRepo = { create: vi.fn().mockResolvedValue({ id: "event-new" }), findByRunId: vi.fn().mockResolvedValue([]) };

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
  const githubClient = { getPRDiff: vi.fn().mockResolvedValue("diff content"), getDefaultBranch: vi.fn() };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
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
    reviewerAgent,
    remediationAgent,
    githubSync,
    gitService,
    logger,
  };
}

describe("OrchestratorService.runReview", () => {
  it("approved verdict: skips postReviewFindings, transitions to ReadyForHumanReview via markReady", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    const run = makeRun({ state: RunState.AIReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, reviewerRuntime: "codex" });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, makeExecutionReport()));
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      return Promise.resolve(null);
    });

    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved", findings: [] }));

    const result = await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(result).toBeDefined();
  });

  it("changes_requested verdict with findings: posts review findings to GitHub, posts Linear comment, and runs remediation with the comment map", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubSync, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const runRemediationSpy = vi
      .spyOn(svc, "runRemediation")
      .mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const run = makeRun({ state: RunState.AIReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, reviewerRuntime: "codex" });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, makeExecutionReport()));
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      return Promise.resolve(null);
    });

    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "oops" }],
    });
    reviewerAgent.run.mockResolvedValue(review);
    githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 101]]));

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith("test-repo", 42, review.findings, "changes_requested");
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Changes Requested"),
    );
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", { f1: 101 });
  });

  it("changes_requested verdict with no findings: does not call postReviewFindings but still remediates", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const runRemediationSpy = vi
      .spyOn(svc, "runRemediation")
      .mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const run = makeRun({ state: RunState.AIReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, reviewerRuntime: "codex" });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, makeExecutionReport()));
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      return Promise.resolve(null);
    });

    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "changes_requested", findings: [] }));

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", {});
  });

  it("refuses to review when the run has no PR number (policy boundary)", async () => {
    const { deps, runRepo, artifactRepo, githubClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, makeExecutionReport()));
      return Promise.resolve(null);
    });

    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);
    expect(githubClient.getPRDiff).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runRemediation", () => {
  it("full happy path: commits remediation changes, posts comments and GitHub updates, transitions to ReadyForHumanReview", async () => {
    const { deps, runRepo, artifactRepo, remediationAgent, githubSync, linearClient, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    const run = makeRun({ state: RunState.AddressingReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, remediationRuntime: "claude-code" });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const execReportV1 = makeExecutionReport({ executionVersion: 1, score: 0.5 });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Review")
        return Promise.resolve(
          asArtifact(
            "Review",
            1,
            makeReview({
              overallVerdict: "changes_requested",
              findings: [{ id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "oops" }],
            }),
          ),
        );
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, execReportV1));
      return Promise.resolve(null);
    });

    const remediation: Remediation = {
      reviewId: "rev-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "Fixed the bug", rationale: "It was real" }],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2, score: 0.95 }),
    };
    remediationAgent.run.mockResolvedValue(remediation);

    const result = await svc.runRemediation("run-1", { f1: 55 });

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      "[AI] Remediation: address review findings",
    );
    expect(linearClient.postComment).toHaveBeenCalledWith("LIN-1", expect.stringContaining("Execution Report"));
    expect(linearClient.postComment).toHaveBeenCalledWith("LIN-1", expect.stringContaining("Remediation Summary"));
    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith("test-repo", 42, remediation.executionReport);
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      remediation.resolution,
      { f1: 55 },
    );
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(result).toBeDefined();
  });

  it("skips the branch commit when the run has no branchName, and skips GitHub updates when there is no PR", async () => {
    const { deps, runRepo, artifactRepo, remediationAgent, githubSync, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    const run = makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: null });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, remediationRuntime: "claude-code" });
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.AIReview });

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Review")
        return Promise.resolve(
          asArtifact(
            "Review",
            1,
            makeReview({
              overallVerdict: "changes_requested",
              findings: [{ id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "oops" }],
            }),
          ),
        );
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, makeExecutionReport()));
      return Promise.resolve(null);
    });

    remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "Fixed", rationale: "Real" }],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2 }),
    } as Remediation);

    await svc.runRemediation("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.markReady", () => {
  it("posts the completion comment and returns the run when policy allows marking ready", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    runRepo.findById.mockResolvedValue(run);

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Review") return Promise.resolve(asArtifact("Review", 1, makeReview({ overallVerdict: "approved" })));
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, makeExecutionReport()));
      return Promise.resolve(null);
    });

    const result = await svc.markReady("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
    expect(result).toBe(run);
  });

  it("throws PolicyViolationError when there is no PR number", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ prNumber: null });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.markReady("run-1")).rejects.toThrow(PolicyViolationError);
  });
});
