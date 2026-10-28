import { describe, it, expect, vi, afterEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact } from "../../src/domain/types.js";
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
    prNumber: 7,
    state: RunState.AIReview,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: "claude-code",
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "" },
      typecheck: { status: "pass", details: "" },
      tests: { status: "pass", details: "" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "good",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeRemediation(overrides: Partial<Remediation> = {}): Remediation {
  return {
    reviewId: "rev-1",
    resolution: [
      { findingId: "f1", status: "accepted", action: "Fixed it", rationale: "Was a real bug" },
    ],
    readyForHumanReview: true,
    executionReport: makeExecutionReport({ executionVersion: 2, score: 0.9 }),
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "ExecutionReport",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  child: () => noopLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function buildDeps(overrides: Record<string, unknown> = {}) {
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

  const runRepo = {
    findById: vi.fn(),
    update: vi.fn().mockImplementation((_id, patch) => Promise.resolve({ ...makeRun(), ...patch })),
    updateState: vi.fn(),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({}),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };

  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "desc",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    }),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = {
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
    getPRDiff: vi.fn().mockResolvedValue("diff --git a b"),
  };

  const repoRegistry = {
    getRepoByName: vi.fn().mockReturnValue(repoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(repoEntry),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
  };

  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/work"),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
  };

  const deps = {
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    gitService,
    repoRegistry,
    linearSync,
    githubSync,
    plannerAgent: {},
    planReviewerAgent: {},
    planReviserAgent: {},
    executorAgent: {},
    reviewerAgent,
    remediationAgent,
    logger: noopLogger,
    ...overrides,
  };

  return { deps, runRepo, artifactRepo, linearClient, githubClient, reviewerAgent, remediationAgent, githubSync, gitService };
}

describe("OrchestratorService.runReview", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fetches the PR diff and routes to remediation when the verdict is changes_requested", async () => {
    const { deps, runRepo, artifactRepo, githubClient, reviewerAgent, githubSync } = buildDeps();
    const run = makeRun();
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" }],
    });
    reviewerAgent.run.mockResolvedValue(review);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.AddressingReview });

    const svc = new OrchestratorService(deps as never);
    const runRemediation = vi
      .spyOn(svc, "runRemediation")
      .mockResolvedValue({ ...run, state: RunState.ReadyForHumanReview });

    const result = await svc.runReview("run-1");

    expect(githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 7);
    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      7,
      review.findings,
      "changes_requested",
    );
    expect(runRemediation).toHaveBeenCalledWith("run-1", {});
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("marks ready when the verdict is approved", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent } = buildDeps();
    const run = makeRun();
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.ReadyForHumanReview });

    const svc = new OrchestratorService(deps as never);
    const markReady = vi
      .spyOn(svc, "markReady")
      .mockResolvedValue({ ...run, state: RunState.ReadyForHumanReview });

    const result = await svc.runReview("run-1");

    expect(markReady).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("does not post review findings when there are no findings even with a PR", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubSync } = buildDeps();
    const run = makeRun();
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved", findings: [] }));
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.ReadyForHumanReview });

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue({ ...run, state: RunState.ReadyForHumanReview });

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runRemediation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("runs remediation, commits, posts comments and GitHub updates, then marks ready", async () => {
    const { deps, runRepo, artifactRepo, linearClient, remediationAgent, githubSync, gitService } = buildDeps();
    const run = makeRun({ state: RunState.AddressingReview });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: makeReview({
              overallVerdict: "changes_requested",
              findings: [{ id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" }],
            }),
          }),
        );
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });
    const remediation = makeRemediation();
    remediationAgent.run.mockResolvedValue(remediation);
    runRepo.update.mockResolvedValue({ ...run, remediationRuntime: "claude-code" });
    runRepo.updateState
      .mockResolvedValueOnce({ ...run, state: RunState.AIReview })
      .mockResolvedValueOnce({ ...run, state: RunState.ReadyForHumanReview });

    const svc = new OrchestratorService(deps as never);
    const markReady = vi
      .spyOn(svc, "markReady")
      .mockResolvedValue({ ...run, state: RunState.ReadyForHumanReview });

    const result = await svc.runRemediation("run-1", { f1: 101 });

    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/work",
      "ai/run-1",
      "[AI] Remediation: address review findings",
    );
    expect(linearClient.postComment).toHaveBeenCalledTimes(2);
    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      7,
      remediation.executionReport,
    );
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      7,
      remediation.resolution,
      { f1: 101 },
    );
    expect(markReady).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("skips GitHub PR updates when the run has no PR number", async () => {
    const { deps, runRepo, artifactRepo, remediationAgent, githubSync } = buildDeps();
    const run = makeRun({ state: RunState.AddressingReview, prNumber: null, branchName: null });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: makeReview({
              overallVerdict: "changes_requested",
              findings: [{ id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" }],
            }),
          }),
        );
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });
    remediationAgent.run.mockResolvedValue(makeRemediation());
    runRepo.update.mockResolvedValue({ ...run, remediationRuntime: "claude-code" });
    runRepo.updateState
      .mockResolvedValueOnce({ ...run, state: RunState.AIReview })
      .mockResolvedValueOnce({ ...run, state: RunState.ReadyForHumanReview });

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue({ ...run, state: RunState.ReadyForHumanReview });

    await svc.runRemediation("run-1");

    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.markReady", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts the completion comment when the policy allows marking ready", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const run = makeRun();
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: makeReview({ overallVerdict: "approved" }) }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.markReady("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
    expect(result.id).toBe("run-1");
  });

  it("throws via the policy engine when the run has no PR", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const run = makeRun({ prNumber: null });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockResolvedValue(null);

    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toThrow(/Cannot mark ready without an existing PR/);
  });
});
