import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

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
    prNumber: 42,
    state: RunState.ReadyForHumanReview,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
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

  const artifactRepo = { create: vi.fn(), findByRunId: vi.fn(), findLatestByType: vi.fn().mockResolvedValue(null) };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = { getIssue: vi.fn(), postComment: vi.fn().mockResolvedValue(undefined), getRelatedContext: vi.fn() };
  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };
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
    assertBranch: vi.fn(),
    commitAndPush: vi.fn(),
    removeWorktree: vi.fn(),
    resolveMainRepoPath: vi.fn(),
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
    linearClient,
    logger,
  };
}

describe("OrchestratorService.approveHumanReview", () => {
  it("transitions to Done and posts the completion comment when there is no distillation agent", async () => {
    const { deps, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = await svc.approveHumanReview("run-1");

    expect(run.state).toBe(RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Human review approved. Run is **Done**.",
    );
  });

  it("invokes the distillation agent (best-effort) before transitioning when configured", async () => {
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
    const { deps } = buildDeps({ distillationAgent });
    const svc = new OrchestratorService(deps as never);

    const run = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    expect(run.state).toBe(RunState.Done);
  });

  it("swallows a distillation agent failure and still completes the run", async () => {
    const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("claude crashed")) };
    const { deps, linearClient, logger } = buildDeps({ distillationAgent });
    const svc = new OrchestratorService(deps as never);

    const run = await svc.approveHumanReview("run-1");

    expect(run.state).toBe(RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "claude crashed" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });
});
