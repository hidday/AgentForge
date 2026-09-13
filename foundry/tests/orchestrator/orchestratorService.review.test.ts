import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
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
    prNumber: 77,
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

function makeExecutionReport(): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Solid",
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

function buildDeps(overrides: { run?: Run; review?: Review } = {}) {
  const run = overrides.run ?? makeRun();
  const plan = makePlan();
  const executionReport = makeExecutionReport();
  const review = overrides.review ?? makeReview();

  const planArtifact = makeArtifact({ type: "Plan", version: 1, payloadJson: plan });
  const execArtifact = makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: executionReport });

  const runRepo = {
    findById: vi.fn().mockResolvedValue(run),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, state: RunState) =>
      Promise.resolve({ ...run, state }),
    ),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) =>
      Promise.resolve({ ...run, ...patch }),
    ),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(planArtifact);
      if (type === "ExecutionReport") return Promise.resolve(execArtifact);
      return Promise.resolve(null);
    }),
  };

  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };

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

  const githubClient = { getPRDiff: vi.fn().mockResolvedValue("diff --git a/src/a.ts b/src/a.ts") };
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
        maxFilesChanged: 100,
        maxDiffLines: 5000,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    }),
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn().mockResolvedValue(new Map([["f1", 123]])),
    postRemediationResolutions: vi.fn(),
    postExecutionReportUpdate: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn().mockResolvedValue(review) };
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
    run,
    runRepo,
    githubClient,
    githubSync,
    linearClient,
    reviewerAgent,
  };
}

describe("OrchestratorService.runReview", () => {
  it("throws via policy when the run is not in AIReview", async () => {
    const { deps } = buildDeps({ run: makeRun({ state: RunState.Implementing }) });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runReview("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
  });

  it("fetches the PR diff via githubClient using the run's repo and PR number", async () => {
    const { deps, githubClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    expect(githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 77);
  });

  it("posts review findings to GitHub and builds a comment map when there are findings and a PR", async () => {
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "important", type: "bug", file: "src/a.ts", title: "Bug", details: "x" },
      ],
    });
    const { deps, githubSync } = buildDeps({ review });
    const svc = new OrchestratorService(deps as never);
    const runRemediationSpy = vi.spyOn(svc, "runRemediation").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      77,
      review.findings,
      "changes_requested",
    );
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", { f1: 123 });
  });

  it("does not post review findings when there are no findings", async () => {
    const { deps, githubSync } = buildDeps({ review: makeReview({ overallVerdict: "approved", findings: [] }) });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
  });

  it("changes_requested: transitions to AddressingReview, posts a code review comment, and remediates", async () => {
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "bug",
          file: "src/a.ts",
          lineHint: 42,
          title: "Off by one",
          details: "loop bound wrong",
        },
        {
          id: "f2",
          severity: "nit",
          type: "style",
          file: "src/b.ts",
          title: "Style nit",
          details: "no line hint here",
        },
      ],
    });
    const { deps, runRepo, linearClient } = buildDeps({ review });
    const svc = new OrchestratorService(deps as never);
    const runRemediationSpy = vi.spyOn(svc, "runRemediation").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.AddressingReview);
    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("AI Code Review"),
    )![1] as string;
    expect(comment).toContain("Changes Requested");
    expect(comment).toContain("src/a.ts:42");
    expect(comment).toContain("src/b.ts");
    expect(comment).not.toContain("src/b.ts:");
    expect(runRemediationSpy).toHaveBeenCalled();
  });

  it("approved: transitions to ReadyForHumanReview and marks the run ready (no code review comment)", async () => {
    const { deps, runRepo, linearClient } = buildDeps({ review: makeReview({ overallVerdict: "approved" }) });
    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.ReadyForHumanReview);
    const codeReviewComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("AI Code Review"),
    );
    expect(codeReviewComment).toBeUndefined();
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
  });

  it("persists reviewerRuntime = codex", async () => {
    const { deps, runRepo } = buildDeps({ review: makeReview({ overallVerdict: "approved" }) });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { reviewerRuntime: "codex" });
  });
});
