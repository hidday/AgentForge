import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RetryExhaustedError } from "../../src/utils/errors.js";
import type { Run } from "../../src/domain/types.js";

// Helper to build a minimal Run object
function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueUrl: "https://linear.app/LIN-1",
    linearIssueTitle: "Test issue",
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Planning,
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
    create: vi.fn(),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };

  const eventRepo = {
    create: vi.fn(),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn(),
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
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-test1234" }),
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
    trace: vi.fn(),
    fatal: vi.fn(),
  };

  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
  };

  const allDeps = {
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
  };

  return {
    deps: allDeps,
    runRepo,
    artifactRepo,
    eventRepo: eventRepo as typeof eventRepo,
    linearClient,
    plannerAgent,
    planReviewerAgent,
    executorAgent,
    reviewerAgent,
    remediationAgent,
    planReviserAgent,
    githubSync,
    linearSync,
  };
}

describe("OrchestratorService graceful degradation (RetryExhaustedError)", () => {
  describe("runExecution", () => {
    it("posts comment to Linear and transitions to HumanClarificationNeeded when executorAgent throws RetryExhaustedError", async () => {
      const { deps, runRepo, artifactRepo, linearClient, executorAgent, eventRepo } =
        buildDeps();
      const svc = new OrchestratorService(deps as never);

      const implementingRun = makeRun({
        state: RunState.Implementing,
        approvedPlanVersion: 1, // required for assertCanExecute
      });
      const clarificationRun = makeRun({ state: RunState.HumanClarificationNeeded });

      runRepo.findById.mockResolvedValue(implementingRun);
      runRepo.updateState.mockResolvedValue(clarificationRun);

      artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
        if (type === "Plan")
          return Promise.resolve({
            id: "art-1",
            runId: "run-1",
            type: "Plan",
            version: 1,
            payloadJson: {
              planVersion: 1,
              summary: "test",
              assumptions: [],
              openQuestions: [],
              risks: [],
              steps: [{ id: "s1", title: "Step 1", description: "Do it" }],
              testPlan: "test",
              confidence: 0.9,
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        if (type === "ExecutionReport")
          return Promise.resolve({
            id: "art-2",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: {
              success: true,
              stage: "execution",
              payload: { summary: "ok", filesChanged: [], checks: {}, notes: [] },
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        return Promise.resolve(null);
      });

      const retryErr = new RetryExhaustedError("execution", "claude-code", [
        { attempt: 1, error: "ECONNRESET", durationMs: 100 },
        { attempt: 2, error: "ECONNRESET", durationMs: 100 },
        { attempt: 3, error: "ECONNRESET", durationMs: 100 },
      ], false);

      executorAgent.run.mockRejectedValue(retryErr);
      eventRepo.create.mockResolvedValue({ id: "event-1" });
      linearClient.getIssue.mockResolvedValue({
        id: "LIN-1",
        title: "Test",
        description: "Test",
        branchName: "ai/lin-1",
        labels: [],
        priority: 0,
      });
      (deps.gitService as never as { commitAndPush: ReturnType<typeof vi.fn> }).commitAndPush =
        vi.fn().mockResolvedValue(undefined);
      (deps.gitService as never as { assertBranch: ReturnType<typeof vi.fn> }).assertBranch =
        vi.fn().mockResolvedValue(undefined);

      const result = await svc.runExecution("run-1");

      // Should post a failure comment to Linear
      expect(linearClient.postComment).toHaveBeenCalledWith(
        "LIN-1",
        expect.stringContaining("execution"),
      );

      // Should transition to HumanClarificationNeeded
      expect(result.state).toBe(RunState.HumanClarificationNeeded);
    });
  });

  describe("runPlanRevision", () => {
    it("posts comment and transitions to HumanClarificationNeeded when planReviserAgent throws RetryExhaustedError", async () => {
      const {
        deps,
        runRepo,
        artifactRepo,
        linearClient,
        planReviserAgent,
        eventRepo,
      } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const planRevisionRun = makeRun({ state: RunState.PlanRevision });
      const clarificationRun = makeRun({ state: RunState.HumanClarificationNeeded });

      runRepo.findById.mockResolvedValue(planRevisionRun);
      runRepo.updateState.mockResolvedValue(clarificationRun);

      artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
        if (type === "Plan" || type === "PlanReview")
          return Promise.resolve({
            id: "art-1",
            runId: "run-1",
            type,
            version: 1,
            payloadJson: {
              planVersion: 1,
              summary: "test",
              assumptions: [],
              openQuestions: [],
              risks: [],
              steps: [],
              testPlan: "test",
              confidence: 0.9,
              overallVerdict: "changes_requested",
              findings: [],
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        return Promise.resolve(null);
      });

      linearClient.getIssue.mockResolvedValue({
        id: "LIN-1",
        title: "Test",
        description: "Test",
        branchName: "ai/lin-1",
        labels: [],
        priority: 0,
      });

      const retryErr = new RetryExhaustedError(
        "plan-revision",
        "claude-code",
        [{ attempt: 1, error: "rate limit exceeded", durationMs: 50 }],
        false,
      );
      planReviserAgent.run.mockRejectedValue(retryErr);
      eventRepo.create.mockResolvedValue({ id: "event-1" });

      const result = await svc.runPlanRevision("run-1");

      // Should post failure comment mentioning the stage
      expect(linearClient.postComment).toHaveBeenCalledWith(
        "LIN-1",
        expect.stringContaining("plan-revision"),
      );

      expect(result.state).toBe(RunState.HumanClarificationNeeded);
    });
  });

  describe("circuit breaker triggered", () => {
    it("posts comment noting circuit breaker was triggered", async () => {
      const { deps, runRepo, artifactRepo, linearClient, executorAgent, eventRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const implementingRun = makeRun({
        state: RunState.Implementing,
        approvedPlanVersion: 1, // required for assertCanExecute
      });
      const clarificationRun = makeRun({ state: RunState.HumanClarificationNeeded });

      runRepo.findById.mockResolvedValue(implementingRun);
      runRepo.updateState.mockResolvedValue(clarificationRun);

      artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
        if (type === "Plan")
          return Promise.resolve({
            id: "art-1",
            runId: "run-1",
            type: "Plan",
            version: 1,
            payloadJson: {
              planVersion: 1,
              summary: "test",
              assumptions: [],
              openQuestions: [],
              risks: [],
              steps: [],
              testPlan: "test",
              confidence: 0.9,
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        if (type === "ExecutionReport")
          return Promise.resolve({
            id: "art-2",
            runId: "run-1",
            type: "ExecutionReport",
            version: 1,
            payloadJson: { success: true, stage: "execution", payload: { summary: "ok", filesChanged: [], checks: {}, notes: [] } },
            rawText: "{}",
            createdAt: new Date(),
          });
        return Promise.resolve(null);
      });

      // Circuit breaker triggered (no attempts)
      const cbErr = new RetryExhaustedError("execution", "claude-code", [], true);
      executorAgent.run.mockRejectedValue(cbErr);
      eventRepo.create.mockResolvedValue({ id: "event-1" });

      linearClient.getIssue.mockResolvedValue({
        id: "LIN-1",
        title: "Test",
        description: "Test",
        branchName: "ai/lin-1",
        labels: [],
        priority: 0,
      });
      (deps.gitService as never as { commitAndPush: ReturnType<typeof vi.fn> }).commitAndPush =
        vi.fn().mockResolvedValue(undefined);
      (deps.gitService as never as { assertBranch: ReturnType<typeof vi.fn> }).assertBranch =
        vi.fn().mockResolvedValue(undefined);

      const result = await svc.runExecution("run-1");

      // Comment should mention circuit breaker
      expect(linearClient.postComment).toHaveBeenCalledWith(
        "LIN-1",
        expect.stringMatching(/circuit breaker/i),
      );

      expect(result.state).toBe(RunState.HumanClarificationNeeded);
    });
  });
});
