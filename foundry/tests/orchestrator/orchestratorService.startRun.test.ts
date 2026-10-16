import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
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
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(null);
      return Promise.resolve(null);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn(),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

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
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
    postExecutionReportUpdate: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({
      worktreePath: "/tmp/worktree",
      branchName: "ai/run-test1234",
    }),
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
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    planReviewerAgent,
    dashboardEmitter,
  };
}

function setupHappyPath(
  deps: ReturnType<typeof buildDeps>["deps"],
  todoRun: Run,
) {
  (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "LIN-1",
    title: "Test",
    description: "Test",
    branchName: "hidday/lin-1-test",
    labels: [],
    priority: 0,
  });
  (deps.repoRegistry.resolveForIssue as ReturnType<typeof vi.fn>).mockReturnValue({
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
  (deps.repoRegistry.resolveWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue("/tmp");
  (deps.repoRegistry.validateWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue(
    undefined,
  );
  (deps.runRepo.findActiveByIssueId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (deps.runRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(todoRun);
}

describe("OrchestratorService.startRun", () => {
  describe("active-run short-circuit", () => {
    it("returns the existing active run without creating a new one", async () => {
      const { deps, runRepo, linearClient } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const activeRun = makeRun({ id: "run-existing", state: RunState.Planning });
      runRepo.findActiveByIssueId.mockResolvedValue(activeRun);

      const result = await svc.startRun("LIN-1");

      expect(result).toBe(activeRun);
      expect(runRepo.create).not.toHaveBeenCalled();
      expect(linearClient.getIssue).not.toHaveBeenCalled();
    });
  });

  describe("happy path (no open questions)", () => {
    it("creates the run, sets up the worktree, plans, and proceeds through plan review to AwaitingPlanApproval", async () => {
      const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent, dashboardEmitter } =
        buildDeps();
      const svc = new OrchestratorService(deps as never);

      const todoRun = makeRun({ state: RunState.Todo });
      const planningRun = makeRun({ state: RunState.Planning });
      const planReviewRun = makeRun({ state: RunState.PlanReview });
      const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval });

      const plan = makePlan({ openQuestions: [] });

      setupHappyPath(deps, todoRun);

      runRepo.findById.mockResolvedValue(planReviewRun);
      runRepo.updateState
        .mockResolvedValueOnce(planningRun) // RUN_REQUESTED -> Planning
        .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED -> PlanReview
        .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVIEW_APPROVED -> AwaitingPlanApproval

      runRepo.update
        .mockResolvedValueOnce({
          ...todoRun,
          workingDirectory: "/tmp/worktree",
          branchName: "ai/run-test1234",
        })
        .mockResolvedValueOnce(planningRun);

      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") {
          return Promise.resolve({
            id: "artifact-plan",
            runId: todoRun.id,
            type: "Plan",
            version: plan.planVersion,
            payloadJson: plan,
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });
      plannerAgent.run.mockResolvedValue(plan);
      planReviewerAgent.run.mockResolvedValue({
        overallVerdict: "approved",
        summary: "Looks good",
        findings: [],
      });

      const result = await svc.startRun("LIN-1");

      expect(runRepo.create).toHaveBeenCalledTimes(1);
      expect(deps.gitService.setupRunWorktree).toHaveBeenCalledWith(
        "/tmp",
        todoRun.id,
        "main",
        "hidday/lin-1-test",
      );
      expect(dashboardEmitter.emitRunCreated).toHaveBeenCalledWith(
        todoRun.id,
        "LIN-1",
        todoRun.repo,
      );
      // No open questions -> researcher/clarification path skipped, planner called once
      expect(plannerAgent.run).toHaveBeenCalledTimes(1);
      expect(plannerAgent.run).toHaveBeenCalledWith(
        expect.anything(),
        todoRun.id,
        expect.objectContaining({ priorSkills: [] }),
      );
      expect(planReviewerAgent.run).toHaveBeenCalledTimes(1);
      expect(result.state).toBe(RunState.AwaitingPlanApproval);
    });
  });

  describe("agent-skill retrieval branch", () => {
    it("injects prior skills and records a SKILL_INJECTION event when agentSkillRepo returns matches", async () => {
      const skillDoc = {
        id: "skill-1",
        repoSlug: "test-repo",
        name: "Retry pattern",
        description: "desc",
        taskCategory: "bugfix",
        skillMarkdown: "# markdown",
        utilityScore: 0.8,
        lastUsedAt: new Date(),
      };
      const agentSkillRepo = {
        findTopKByRelevance: vi.fn().mockResolvedValue([skillDoc]),
      };

      const { deps, runRepo, artifactRepo, eventRepo, plannerAgent, planReviewerAgent } =
        buildDeps({ agentSkillRepo });
      const svc = new OrchestratorService(deps as never);

      const todoRun = makeRun({ state: RunState.Todo });
      const planningRun = makeRun({ state: RunState.Planning });
      const planReviewRun = makeRun({ state: RunState.PlanReview });
      const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval });
      const plan = makePlan({ openQuestions: [] });

      setupHappyPath(deps, todoRun);
      runRepo.findById.mockResolvedValue(planReviewRun);
      runRepo.updateState
        .mockResolvedValueOnce(planningRun)
        .mockResolvedValueOnce(planReviewRun)
        .mockResolvedValueOnce(awaitingApprovalRun);
      runRepo.update
        .mockResolvedValueOnce({
          ...todoRun,
          workingDirectory: "/tmp/worktree",
          branchName: "ai/run-test1234",
        })
        .mockResolvedValueOnce(planningRun);

      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") {
          return Promise.resolve({
            id: "artifact-plan",
            runId: todoRun.id,
            type: "Plan",
            version: plan.planVersion,
            payloadJson: plan,
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });
      plannerAgent.run.mockResolvedValue(plan);
      planReviewerAgent.run.mockResolvedValue({
        overallVerdict: "approved",
        summary: "ok",
        findings: [],
      });

      await svc.startRun("LIN-1");

      expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalled();
      expect(plannerAgent.run).toHaveBeenCalledWith(
        expect.anything(),
        todoRun.id,
        expect.objectContaining({ priorSkills: [skillDoc] }),
      );
      const injectionEvent = eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
      );
      expect(injectionEvent).toBeDefined();
      expect(
        (injectionEvent![0] as { payloadJson: { skillIds: string[] } }).payloadJson.skillIds,
      ).toEqual(["skill-1"]);
    });

    it("passes an empty priorSkills array and records no SKILL_INJECTION event when agentSkillRepo is undefined", async () => {
      const { deps, runRepo, artifactRepo, eventRepo, plannerAgent, planReviewerAgent } =
        buildDeps();
      const svc = new OrchestratorService(deps as never);

      const todoRun = makeRun({ state: RunState.Todo });
      const planningRun = makeRun({ state: RunState.Planning });
      const planReviewRun = makeRun({ state: RunState.PlanReview });
      const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval });
      const plan = makePlan({ openQuestions: [] });

      setupHappyPath(deps, todoRun);
      runRepo.findById.mockResolvedValue(planReviewRun);
      runRepo.updateState
        .mockResolvedValueOnce(planningRun)
        .mockResolvedValueOnce(planReviewRun)
        .mockResolvedValueOnce(awaitingApprovalRun);
      runRepo.update
        .mockResolvedValueOnce({
          ...todoRun,
          workingDirectory: "/tmp/worktree",
          branchName: "ai/run-test1234",
        })
        .mockResolvedValueOnce(planningRun);

      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") {
          return Promise.resolve({
            id: "artifact-plan",
            runId: todoRun.id,
            type: "Plan",
            version: plan.planVersion,
            payloadJson: plan,
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });
      plannerAgent.run.mockResolvedValue(plan);
      planReviewerAgent.run.mockResolvedValue({
        overallVerdict: "approved",
        summary: "ok",
        findings: [],
      });

      await svc.startRun("LIN-1");

      expect(plannerAgent.run).toHaveBeenCalledWith(
        expect.anything(),
        todoRun.id,
        expect.objectContaining({ priorSkills: [] }),
      );
      const injectionEvent = eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
      );
      expect(injectionEvent).toBeUndefined();
    });
  });
});
