import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run } from "../../src/domain/types.js";

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
    state: RunState.ReadyForHumanReview,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: "claude-code",
    reviewerRuntime: "codex",
    remediationRuntime: null,
    workingDirectory: "/tmp/worktree",
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
    update: vi.fn(),
    updateState: vi.fn(),
  };

  const artifactRepo = { create: vi.fn(), findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
  };
  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn(),
    // cleanupRunWorktree calls gitService.resolveMainRepoPath directly, not via repoRegistry.
  };
  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postExecutionReportUpdate: vi.fn(),
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
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/main-repo"),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

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
      distillationAgent,
      ...overrides,
    },
    runRepo,
    eventRepo,
    linearClient,
    gitService,
    logger,
    distillationAgent,
  };
}

describe("OrchestratorService.approveHumanReview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs the distillation agent, transitions to Done, posts a comment, and returns the updated run", async () => {
    const { deps, runRepo, linearClient, distillationAgent } = buildDeps();
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    const doneRun = makeRun({ state: RunState.Done });
    runRepo.updateState.mockResolvedValue(doneRun);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", run);
    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Human review approved. Run is **Done**.",
    );
    expect(result.state).toBe(RunState.Done);
  });

  it("cleans up the worktree once the run reaches Done (differing workingDirectory/main repo path)", async () => {
    const { deps, runRepo, gitService } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));
    runRepo.updateState.mockResolvedValue(
      makeRun({ state: RunState.Done, workingDirectory: "/tmp/worktree" }),
    );
    gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-repo"); // differs from workingDirectory

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).toHaveBeenCalledWith("/tmp/main-repo", "/tmp/worktree");
  });

  it("logs a warning and still proceeds to HUMAN_APPROVED when the distillation agent throws", async () => {
    const { deps, runRepo, logger, distillationAgent, linearClient } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));
    distillationAgent.run.mockRejectedValue(new Error("distillation boom"));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation boom" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Human review approved. Run is **Done**.",
    );
    expect(result.state).toBe(RunState.Done);
  });

  it("skips the distillation agent entirely when it is not configured", async () => {
    const { deps, runRepo } = buildDeps({ distillationAgent: undefined });
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });

  it("records the HUMAN_APPROVED event", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.HUMAN_APPROVED);
  });
});
