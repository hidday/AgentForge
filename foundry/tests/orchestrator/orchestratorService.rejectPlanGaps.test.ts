import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

// Covers two gaps left after the main rejectPlan/runPlanning coverage passes:
//  1. rejectPlan's iterate-mode re-plan producing blocking questions (pauses
//     for human clarification instead of proceeding to plan review), and
//     loadReplanContext's planReviewFindings branch (a PlanReview artifact
//     is present from a prior cycle).
//  2. buildTaskBundle's "remote default branch differs from config" warning
//     path.

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
    prNumber: null,
    state: RunState.AwaitingPlanApproval,
    planVersion: 2,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 3,
    summary: "Re-plan",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 2,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

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
    findLatestByType: vi.fn().mockResolvedValue(null as Artifact | null),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "desc",
      branchName: "ai/run-1",
      labels: [] as string[],
      priority: 0,
      url: null,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = {
    getPRDiff: vi.fn(),
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
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };

  const plannerAgent = { run: vi.fn().mockResolvedValue(makePlan()) };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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
    plannerAgent,
    githubClient,
    repoRegistry,
    logger,
  };
}

describe("OrchestratorService.rejectPlan — iterate mode with blocking questions", () => {
  it("pauses for human clarification when the re-plan has required open questions, and picks up prior PlanReview findings", async () => {
    const { deps, artifactRepo, plannerAgent } = buildDeps();

    // A PlanReview artifact from the prior cycle, picked up by loadReplanContext.
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "PlanReview") {
        return Promise.resolve(
          makeArtifact({
            type: "PlanReview",
            payloadJson: {
              summary: "Needs more detail",
              findings: [
                { id: "f1", severity: "major", title: "Missing tests", details: "Add tests" },
              ],
            },
          }),
        );
      }
      if (type === "HumanAnswers") {
        return Promise.resolve(
          makeArtifact({
            type: "HumanAnswers",
            payloadJson: { answers: [{ questionId: "q0", answer: "staging" }] },
          }),
        );
      }
      if (type === "ResearchedAnswers") {
        return Promise.resolve(
          makeArtifact({
            type: "ResearchedAnswers",
            payloadJson: { answers: [{ questionId: "q0", answer: "staging", source: "docs" }] },
          }),
        );
      }
      return Promise.resolve(null);
    });

    plannerAgent.run.mockResolvedValue(
      makePlan({
        openQuestions: [
          { id: "q1", question: "Which env?", requiredForExecution: true },
        ],
      }),
    );

    const svc = new OrchestratorService(deps as never);
    const run = await svc.rejectPlan("run-1", "needs more work", "api", "iterate");

    // loadReplanContext's PlanReview/HumanAnswers/ResearchedAnswers branches
    // all fed through to the planner options.
    const options = plannerAgent.run.mock.calls[0]![2] as Record<string, unknown>;
    expect(options.planReviewFindings).toEqual({
      summary: "Needs more detail",
      findings: [{ id: "f1", severity: "major", title: "Missing tests", details: "Add tests" }],
    });
    expect(options.humanAnswers).toEqual([{ questionId: "q0", answer: "staging" }]);
    expect(options.researchedAnswers).toEqual([
      { questionId: "q0", answer: "staging", source: "docs" },
    ]);

    // Blocking questions short-circuit straight to HumanClarificationNeeded
    // rather than proceeding through plan review.
    expect(run.state).toBe(RunState.HumanClarificationNeeded);
  });

  it("warns when GitHub's default branch differs from the configured one", async () => {
    const { deps, githubClient, repoRegistry, logger, plannerAgent } = buildDeps();
    githubClient.getDefaultBranch.mockResolvedValue("develop");
    repoRegistry.getRepoByName.mockReturnValue({
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
    });
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.rejectPlan("run-1", "needs more work", "api", "iterate");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "develop" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
  });
});
