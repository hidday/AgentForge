import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact } from "../../src/domain/types.js";
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
    prNumber: null,
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
    filesChanged: [],
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

function asArtifact(params: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${params.type}-${params.version}`,
    runId: "run-1",
    type: params.type as Artifact["type"],
    version: params.version,
    payloadJson: params.payloadJson,
    rawText: JSON.stringify(params.payloadJson),
    createdAt: new Date(),
  };
}

function buildDeps(initialRun: Run, planArtifact: Artifact) {
  let runState = initialRun.state;

  const runRepo = {
    findById: vi.fn().mockImplementation((id: string) => Promise.resolve({ ...initialRun, id, state: runState })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      runState = newState;
      return Promise.resolve({ ...initialRun, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, params: Record<string, unknown>) => {
      Object.assign(initialRun, params);
      return Promise.resolve({ ...initialRun, ...params, state: runState });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(planArtifact);
      return Promise.resolve(null);
    }),
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
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
      project: "test-project",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn(),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoEntry = {
    name: "test-repo",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [],
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 100,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(repoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/test-repo"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(repoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(repoEntry),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
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
    linearClient,
    executorAgent,
  };
}

describe("OrchestratorService execution report comment formatting (via runExecution)", () => {
  it("omits the Files changed section entirely when no files changed", async () => {
    const plan = makePlan();
    const planArtifact = asArtifact({ type: "Plan", version: 1, payloadJson: plan });
    const run = makeRun();
    const built = buildDeps(run, planArtifact);
    built.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: [], notes: [] }),
      prNumber: 1,
    });

    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));
    await svc.runExecution("run-1");

    const comment = built.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    )![1] as string;

    expect(comment).not.toContain("Files changed");
    expect(comment).not.toContain("### Notes");
  });

  it("lists files plainly when there are 8 or fewer", async () => {
    const plan = makePlan();
    const planArtifact = asArtifact({ type: "Plan", version: 1, payloadJson: plan });
    const run = makeRun();
    const built = buildDeps(run, planArtifact);
    const files = Array.from({ length: 8 }, (_, i) => `src/file${i}.ts`);
    built.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: files }),
      prNumber: 1,
    });

    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));
    await svc.runExecution("run-1");

    const comment = built.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    )![1] as string;

    expect(comment).toContain("Files changed (8)");
    expect(comment).not.toContain("<details>");
    expect(comment).toContain("src/file0.ts");
  });

  it("collapses the file list inside <details> when there are more than 8 files, and includes notes", async () => {
    const plan = makePlan();
    const planArtifact = asArtifact({ type: "Plan", version: 1, payloadJson: plan });
    const run = makeRun();
    const built = buildDeps(run, planArtifact);
    const files = Array.from({ length: 12 }, (_, i) => `src/file${i}.ts`);
    built.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: files, notes: ["Skipped the flaky test"] }),
      prNumber: 1,
    });

    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));
    await svc.runExecution("run-1");

    const comment = built.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    )![1] as string;

    expect(comment).toContain("<details>");
    expect(comment).toContain("Files changed (12)");
    expect(comment).toContain("### Notes");
    expect(comment).toContain("Skipped the flaky test");
  });

  it("renders the fail and skip check icons", async () => {
    const plan = makePlan();
    const planArtifact = asArtifact({ type: "Plan", version: 1, payloadJson: plan });
    const run = makeRun();
    const built = buildDeps(run, planArtifact);
    built.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "unused var" },
          typecheck: { status: "skip", details: "not run" },
          tests: { status: "pass", details: "ok" },
        },
      }),
      prNumber: 1,
    });

    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));
    await svc.runExecution("run-1");

    const comment = built.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    )![1] as string;

    expect(comment).toContain(":x:");
    expect(comment).toContain(":heavy_minus_sign:");
    expect(comment).toContain(":white_check_mark:");
  });
});
