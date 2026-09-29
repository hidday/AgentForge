import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, RunEventRecord } from "../../src/domain/types.js";

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
    state: RunState.ReadyForHumanReview,
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

function buildDeps(overrides: {
  run?: Run;
  distillationAgent?: { run: ReturnType<typeof vi.fn> } | undefined;
  agentSkillRepo?: Record<string, ReturnType<typeof vi.fn>>;
  events?: RunEventRecord[];
  mainRepoPath?: string;
} = {}) {
  const run = overrides.run ?? makeRun();
  let currentRun: Run = { ...run };

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(currentRun)),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, state: RunState) => {
      currentRun = { ...currentRun, state };
      return Promise.resolve({ ...currentRun });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      currentRun = { ...currentRun, ...patch };
      return Promise.resolve({ ...currentRun });
    }),
  };

  const artifactRepo = { create: vi.fn(), findByRunId: vi.fn(), findLatestByType: vi.fn().mockResolvedValue(null) };
  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
    findByRunId: vi.fn().mockResolvedValue(overrides.events ?? []),
  };
  const linearClient = { getIssue: vi.fn(), postComment: vi.fn().mockResolvedValue(undefined) };
  const githubClient = { getPRDiff: vi.fn() };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn(),
  };
  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined) };
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
    resolveMainRepoPath: vi.fn().mockReturnValue(overrides.mainRepoPath ?? run.workingDirectory),
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
      distillationAgent: overrides.distillationAgent,
      agentSkillRepo: overrides.agentSkillRepo,
    },
    run,
    runRepo,
    eventRepo,
    linearClient,
    gitService,
    logger,
  };
}

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, and posts the completion comment", async () => {
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
    const { deps, runRepo, linearClient } = buildDeps({ distillationAgent });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalledWith("LIN-1", expect.stringContaining("Done"));
    expect(result.state).toBe(RunState.Done);
  });

  it("swallows a distillation failure (best-effort) and still completes the run", async () => {
    const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("distillation boom")) };
    const { deps, runRepo, logger } = buildDeps({ distillationAgent });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.Done);
    const warnCall = logger.warn.mock.calls.find((c: unknown[]) =>
      String(c[1]).includes("Distillation agent failed"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { error: string }).error).toBe("distillation boom");
  });

  it("skips distillation entirely when no distillationAgent is configured", async () => {
    const { deps, runRepo } = buildDeps({ distillationAgent: undefined });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.Done);
  });

  it("cleans up the run worktree when the main repo path differs from the run's working directory", async () => {
    const { deps, gitService } = buildDeps({
      mainRepoPath: "/repos/main",
      run: makeRun({ workingDirectory: "/repos/main/.worktrees/run-1" }),
    });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).toHaveBeenCalledWith(
      "/repos/main",
      "/repos/main/.worktrees/run-1",
    );
  });

  it("does not attempt worktree cleanup when the main repo path equals the working directory", async () => {
    const { deps, gitService } = buildDeps({ mainRepoPath: "/tmp/worktree" });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("updates skill metrics (success) for skills injected during the run's lifecycle", async () => {
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockResolvedValue({
        id: "skill-1",
        successCount: 3,
        failureCount: 0,
        utilityScore: 0.8,
      }),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const injectionEvent: RunEventRecord = {
      id: "evt-skill",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-1"] },
      createdAt: new Date(),
    };
    const { deps } = buildDeps({ agentSkillRepo, events: [injectionEvent] });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(
      expect.objectContaining({ id: "skill-1" }),
    );
  });

  it("deduplicates skill IDs across multiple SKILL_INJECTION events and swallows a per-skill update failure", async () => {
    const agentSkillRepo = {
      incrementSuccess: vi
        .fn()
        .mockResolvedValueOnce({ id: "skill-1", successCount: 1, failureCount: 0, utilityScore: 0.5 })
        .mockRejectedValueOnce(new Error("db down")),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const events: RunEventRecord[] = [
      {
        id: "evt-1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1", "skill-2"] },
        createdAt: new Date(),
      },
      {
        id: "evt-2",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] },
        createdAt: new Date(),
      },
    ];
    const { deps, logger } = buildDeps({ agentSkillRepo, events });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    const warnCall = logger.warn.mock.calls.find((c: unknown[]) =>
      String(c[1]).includes("Failed to update skill metric"),
    );
    expect(warnCall).toBeDefined();
  });
});
