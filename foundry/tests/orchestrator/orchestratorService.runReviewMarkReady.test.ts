import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/x",
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
    workingDirectory: "/work",
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
    score: 0.8,
    scoreRationale: "Solid.",
    ...overrides,
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
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "title",
      description: "desc",
      branchName: "ai/run-1",
      state: "AIReview",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };
  const githubClient = { getPRDiff: vi.fn().mockResolvedValue("diff --git a b") };
  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/work"),
  };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn(),
  };
  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn().mockResolvedValue(new Map([["f1", 101]])),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };
  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  return {
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
  };
}

function spyBuildTaskBundle(svc: OrchestratorService) {
  return vi
    .spyOn(svc as unknown as { buildTaskBundle: (...a: unknown[]) => Promise<TaskBundle> }, "buildTaskBundle")
    .mockResolvedValue({
      issue: { id: "LIN-1", title: "title", description: "desc", labels: [], priority: 0 },
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/run-1",
        repoPath: "/work",
        allowedPaths: ["src/"],
        protectedPaths: [],
      },
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
      definitionOfDone: [],
    });
}

function buildReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "s",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

describe("OrchestratorService.runReview", () => {
  it("fetches the PR diff when prNumber is set and passes it to the reviewer agent", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun());
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve({ payloadJson: makeExecutionReport() });
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan() });
      return Promise.resolve(null);
    });
    deps.reviewerAgent.run.mockResolvedValue(buildReview());
    deps.runRepo.update.mockResolvedValue(makeRun());
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    expect(deps.githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 42);
    expect(deps.reviewerAgent.run.mock.calls[0][2]).toBe("diff --git a b");
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
  });

  it("posts review findings to GitHub and builds a commentMap when there are findings and a PR exists", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun());
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve({ payloadJson: makeExecutionReport() });
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan() });
      return Promise.resolve(null);
    });
    const review = buildReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }],
    });
    deps.reviewerAgent.run.mockResolvedValue(review);
    deps.runRepo.update.mockResolvedValue(makeRun());
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);
    const runRemediationSpy = vi.spyOn(svc, "runRemediation").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    expect(deps.githubSync.postReviewFindings).toHaveBeenCalledWith("test-repo", 42, review.findings, "changes_requested");
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", { f1: 101 });
  });

  it("skips postReviewFindings when there are no findings", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun());
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve({ payloadJson: makeExecutionReport() });
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan() });
      return Promise.resolve(null);
    });
    deps.reviewerAgent.run.mockResolvedValue(buildReview({ overallVerdict: "approved", findings: [] }));
    deps.runRepo.update.mockResolvedValue(makeRun());
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    expect(deps.githubSync.postReviewFindings).not.toHaveBeenCalled();
  });

  it("on approved verdict: transitions to ReadyForHumanReview and delegates to markReady", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun());
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve({ payloadJson: makeExecutionReport() });
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan() });
      return Promise.resolve(null);
    });
    deps.reviewerAgent.run.mockResolvedValue(buildReview({ overallVerdict: "approved" }));
    deps.runRepo.update.mockResolvedValue(makeRun());
    const finalRun = makeRun({ state: RunState.ReadyForHumanReview });
    deps.runRepo.updateState.mockResolvedValue(finalRun);

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    const result = await svc.runReview("run-1");

    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(deps.linearClient.postComment).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.markReady", () => {
  it("posts the completion comment when the run passes all markReady policy checks", async () => {
    const deps = buildDeps();
    const run = makeRun({ state: RunState.AddressingReview, prNumber: 42 });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review") return Promise.resolve({ payloadJson: buildReview({ overallVerdict: "approved" }) });
      if (type === "ExecutionReport") return Promise.resolve({ payloadJson: makeExecutionReport() });
      return Promise.resolve(null);
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.markReady("run-1");

    expect(deps.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
    expect(result).toBe(run);
  });

  it("throws a PolicyViolationError and never posts a comment when there is no PR", async () => {
    const deps = buildDeps();
    const run = makeRun({ prNumber: null });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);

    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toThrow(PolicyViolationError);
    expect(deps.linearClient.postComment).not.toHaveBeenCalled();
  });

  it("throws when the latest review verdict is not approved", async () => {
    const deps = buildDeps();
    const run = makeRun({ prNumber: 42 });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review")
        return Promise.resolve({ payloadJson: buildReview({ overallVerdict: "changes_requested" }) });
      if (type === "ExecutionReport") return Promise.resolve({ payloadJson: makeExecutionReport() });
      return Promise.resolve(null);
    });

    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toThrow(/approved/);
  });
});
