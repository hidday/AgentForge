import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.AwaitingPlanApproval,
    planVersion: 2,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(): Plan {
  return {
    planVersion: 3,
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

function buildDeps(linearClientOverrides: Record<string, unknown> = {}) {
  const runInitial = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
  const runPlanning = makeRun({ state: RunState.Planning, planVersion: 2 });
  const runPlanReviewState = makeRun({ state: RunState.PlanReview, planVersion: 3 });
  const runAfterUpdate = makeRun({ state: RunState.Planning, planVersion: 3 });
  const runAwaitingApproval = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 });

  const newPlan = makePlan();

  const runRepo = {
    findById: vi
      .fn()
      .mockResolvedValueOnce(runInitial)
      .mockResolvedValue(runPlanReviewState),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi
      .fn()
      .mockResolvedValueOnce(runPlanning)
      .mockResolvedValueOnce(runPlanReviewState)
      .mockResolvedValueOnce(runAwaitingApproval),
    update: vi.fn().mockResolvedValue(runAfterUpdate),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          id: "artifact-plan",
          runId: "run-1",
          type: "Plan",
          version: 3,
          payloadJson: newPlan,
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
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
    ...linearClientOverrides,
  };

  const githubClient = { getPRDiff: vi.fn() };

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

  const plannerAgent = { run: vi.fn().mockResolvedValue(newPlan) };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "Looks good",
      findings: [],
    }),
  };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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
    linearClient,
    plannerAgent,
    logger,
  };
}

describe("OrchestratorService.buildTaskBundle relatedContext propagation", () => {
  it("calls linearClient.getRelatedContext and forwards parent + blockers on the TaskBundle to the planner", async () => {
    const relatedContext = {
      parent: {
        id: "p1",
        identifier: "PRY-100",
        title: "Umbrella feature X",
        description: "Roll-up effort.",
        state: "In Progress",
        labels: ["epic"],
        priority: 2,
        url: "https://linear.app/team/issue/PRY-100",
      },
      blockers: [
        {
          id: "b1",
          identifier: "PRY-101",
          title: "Migration prerequisite",
          description: "Must complete migration first.",
          state: "Todo",
          labels: ["infra"],
          priority: 1,
          url: "https://linear.app/team/issue/PRY-101",
        },
      ],
    };

    const { deps, linearClient, plannerAgent } = buildDeps({
      getRelatedContext: vi.fn().mockResolvedValue(relatedContext),
    });

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1", "Some feedback", "api");

    expect(linearClient.getRelatedContext).toHaveBeenCalledWith("LIN-1");

    const plannerCall = (plannerAgent.run as ReturnType<typeof vi.fn>).mock.calls[0];
    const passedBundle = plannerCall[0] as TaskBundle;

    expect(passedBundle.relatedContext).toBeDefined();
    expect(passedBundle.relatedContext?.parent?.identifier).toBe("PRY-100");
    expect(passedBundle.relatedContext?.blockers).toHaveLength(1);
    expect(passedBundle.relatedContext?.blockers[0].identifier).toBe("PRY-101");
  });

  it("omits relatedContext on the TaskBundle when neither parent nor blockers exist", async () => {
    const { deps, plannerAgent } = buildDeps({
      getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    });

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1");

    const plannerCall = (plannerAgent.run as ReturnType<typeof vi.fn>).mock.calls[0];
    const passedBundle = plannerCall[0] as TaskBundle;

    expect(passedBundle.relatedContext).toBeUndefined();
  });

  it("fails soft when getRelatedContext throws: omits relatedContext, logs warn, and continues planning", async () => {
    const error = new Error("Linear API rate limited");
    const { deps, plannerAgent, logger } = buildDeps({
      getRelatedContext: vi.fn().mockRejectedValue(error),
    });

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1");

    const plannerCall = (plannerAgent.run as ReturnType<typeof vi.fn>).mock.calls[0];
    const passedBundle = plannerCall[0] as TaskBundle;

    expect(passedBundle.relatedContext).toBeUndefined();

    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find((call: unknown[]) =>
      typeof call[1] === "string" &&
      (call[1] as string).includes("Failed to fetch related Linear context"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { issueId: string; error: string }).issueId).toBe("LIN-1");
    expect((warnCall![0] as { issueId: string; error: string }).error).toBe(
      "Linear API rate limited",
    );
  });
});
