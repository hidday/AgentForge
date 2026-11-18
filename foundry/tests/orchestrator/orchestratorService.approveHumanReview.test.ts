import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";

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
    prNumber: 7,
    state: RunState.ReadyForHumanReview,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/.worktrees/run-1",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface Store {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildDeps(store: Store, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.run = { ...store.run, state: newState };
      return Promise.resolve({ ...store.run });
    }),
    update: vi.fn().mockImplementation((_id: string, data: Partial<Run>) => {
      store.run = { ...store.run, ...data };
      return Promise.resolve({ ...store.run });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn(),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const e: RunEventRecord = {
        id: `evt-${store.events.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(e);
      return Promise.resolve(e);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
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
    eventRepo,
    linearClient,
    gitService,
    logger,
  };
}

describe("OrchestratorService.approveHumanReview", () => {
  it("throws when the run does not exist", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps, runRepo } = buildDeps(store);
    runRepo.findById.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approveHumanReview("missing")).rejects.toThrow(/Run not found/);
  });

  it("without a distillationAgent: transitions to Done, posts the completion comment, and cleans up the worktree", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps, linearClient, gitService, eventRepo } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Human review approved. Run is **Done**.",
    );
    const eventTypes = eventRepo.create.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain(RunEvent.HUMAN_APPROVED);
    // Worktree cleanup fires because resolveMainRepoPath differs from workingDirectory.
    expect(gitService.removeWorktree).toHaveBeenCalledWith("/tmp", "/tmp/.worktrees/run-1");
  });

  it("does not clean up the worktree when workingDirectory is already the main repo path", async () => {
    const store: Store = { run: makeRun({ workingDirectory: "/repo" }), artifacts: [], events: [] };
    const { deps, gitService } = buildDeps(store);
    gitService.resolveMainRepoPath.mockReturnValue("/repo");
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("runs the distillation agent before transitioning when one is configured", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
    const { deps, eventRepo } = buildDeps(store, { distillationAgent });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    // Distillation ran strictly before the HUMAN_APPROVED transition's event.
    const callOrder = distillationAgent.run.mock.invocationCallOrder[0];
    const humanApprovedEvt = eventRepo.create.mock.calls.find(
      (c) => (c[0] as { eventType: string }).eventType === RunEvent.HUMAN_APPROVED,
    );
    expect(humanApprovedEvt).toBeDefined();
    expect(callOrder).toBeLessThan(eventRepo.create.mock.invocationCallOrder[eventRepo.create.mock.calls.indexOf(humanApprovedEvt!)]);
  });

  it("swallows distillation agent failures (best-effort) and still completes the run", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("distillation blew up")) };
    const { deps, logger } = buildDeps(store, { distillationAgent });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation blew up" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("updates skill metrics (success) for every skill injected earlier in the run's lifecycle", async () => {
    const store: Store = {
      run: makeRun(),
      artifacts: [],
      events: [
        {
          id: "e0",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-a", "skill-b"] },
          createdAt: new Date(),
        },
      ],
    };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockImplementation((id: string) =>
        Promise.resolve({
          id,
          repoSlug: "test-repo",
          name: "n",
          description: "d",
          taskCategory: "cat",
          skillMarkdown: "md",
          successCount: 1,
          failureCount: 0,
          utilityScore: 0.5,
          lastUsedAt: new Date(),
        }),
      ),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps } = buildDeps(store, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-a");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-b");
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
  });

  it("logs a warning but does not throw when a skill metric update fails", async () => {
    const store: Store = {
      run: makeRun(),
      artifacts: [],
      events: [
        {
          id: "e0",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-a"] },
          createdAt: new Date(),
        },
      ],
    };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockRejectedValue(new Error("db down")),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, logger } = buildDeps(store, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-a", error: "db down" }),
      "Failed to update skill metric",
    );
  });

  it("deduplicates skill ids seen across multiple SKILL_INJECTION events", async () => {
    const store: Store = {
      run: makeRun(),
      artifacts: [],
      events: [
        {
          id: "e0",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-a"] },
          createdAt: new Date(),
        },
        {
          id: "e1",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-a", "skill-c"] },
          createdAt: new Date(),
        },
      ],
    };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockImplementation((id: string) =>
        Promise.resolve({
          id,
          repoSlug: "test-repo",
          name: "n",
          description: "d",
          taskCategory: "cat",
          skillMarkdown: "md",
          successCount: 1,
          failureCount: 0,
          utilityScore: 0.5,
          lastUsedAt: new Date(),
        }),
      ),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps } = buildDeps(store, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-a");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-c");
  });

  it("does nothing for skill metrics when no agentSkillRepo is configured", async () => {
    const store: Store = {
      run: makeRun(),
      artifacts: [],
      events: [
        {
          id: "e0",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-a"] },
          createdAt: new Date(),
        },
      ],
    };
    const { deps } = buildDeps(store, { agentSkillRepo: undefined });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });

  it("uses String(err) for a non-Error distillation rejection", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const distillationAgent = { run: vi.fn().mockRejectedValue("just a string failure") };
    const { deps, logger } = buildDeps(store, { distillationAgent });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "just a string failure" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("defaults to an empty skillIds list when a SKILL_INJECTION event's payload omits it", async () => {
    const store: Store = {
      run: makeRun(),
      artifacts: [],
      events: [
        {
          id: "e0",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: {},
          createdAt: new Date(),
        },
      ],
    };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps } = buildDeps(store, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("does nothing for skill metrics when there are no SKILL_INJECTION events", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps } = buildDeps(store, { agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });
});
