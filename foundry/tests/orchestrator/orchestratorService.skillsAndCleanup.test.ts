import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord, SkillDocument } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: "Fix the login bug",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.ReadyForHumanReview,
    planVersion: 1,
    approvedPlanVersion: null,
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

function makeSkill(overrides: Partial<SkillDocument> = {}): SkillDocument {
  return {
    id: "skill-1",
    repoSlug: "test-repo",
    name: "Auth patterns",
    description: "How we handle auth in this repo",
    taskCategory: "auth",
    skillMarkdown: "# Auth\nUse OAuth2.",
    utilityScore: 0.5,
    lastUsedAt: new Date(),
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
    findLatestByType: vi.fn().mockResolvedValue(null),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

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
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/main-repo"),
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

  const agentSkillRepo = {
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn(),
    incrementFailure: vi.fn(),
    archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
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
      distillationAgent,
      agentSkillRepo,
      logger,
      dashboardEmitter,
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    gitService,
    agentSkillRepo,
    logger,
  };
}

// retrieveSkillsForPlanning and updateSkillMetrics are private, but they are
// exercised indirectly via public entry points (startRun uses the former,
// transitionAndRecord into Done/Failed uses the latter). We call through
// those entry points directly with minimal fixtures to keep the tests
// focused on the skill-handling logic itself rather than full run flows.
describe("OrchestratorService skill retrieval and metrics (via startRun / approveHumanReview)", () => {
  it("retrieveSkillsForPlanning returns [] and skips the SKILL_INJECTION event when agentSkillRepo is not configured", async () => {
    const { deps, eventRepo } = buildDeps({ agentSkillRepo: undefined });
    const svc = new OrchestratorService(deps as never);

    // Call the private method via a cast to validate its own behavior in
    // isolation (it has no state-machine side effects of its own).
    const skills = await (svc as unknown as {
      retrieveSkillsForPlanning: (run: Run) => Promise<SkillDocument[]>;
    }).retrieveSkillsForPlanning(makeRun());

    expect(skills).toEqual([]);
    expect(eventRepo.create).not.toHaveBeenCalled();
  });

  it("retrieveSkillsForPlanning queries by repo+title+description and records SKILL_INJECTION when skills are found", async () => {
    const { deps, eventRepo, agentSkillRepo } = buildDeps();
    const skill = makeSkill();
    agentSkillRepo.findTopKByRelevance.mockResolvedValue([skill]);

    const svc = new OrchestratorService(deps as never);
    const run = makeRun({
      linearIssueTitle: "Fix login bug",
      linearIssueDescription: "Users cannot log in with SSO",
    });

    const skills = await (svc as unknown as {
      retrieveSkillsForPlanning: (run: Run) => Promise<SkillDocument[]>;
    }).retrieveSkillsForPlanning(run);

    expect(skills).toEqual([skill]);
    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Fix login bug"),
      expect.any(Number),
    );
    const injectionEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvent).toBeDefined();
    expect((injectionEvent![0] as { payloadJson: { skillIds: string[] } }).payloadJson.skillIds).toEqual([
      "skill-1",
    ]);
  });

  it("retrieveSkillsForPlanning does not record SKILL_INJECTION when no skills are found", async () => {
    const { deps, eventRepo, agentSkillRepo } = buildDeps();
    agentSkillRepo.findTopKByRelevance.mockResolvedValue([]);

    const svc = new OrchestratorService(deps as never);
    const skills = await (svc as unknown as {
      retrieveSkillsForPlanning: (run: Run) => Promise<SkillDocument[]>;
    }).retrieveSkillsForPlanning(makeRun());

    expect(skills).toEqual([]);
    expect(eventRepo.create).not.toHaveBeenCalled();
  });

  it("updateSkillMetrics no-ops when agentSkillRepo is not configured", async () => {
    const { deps, eventRepo } = buildDeps({ agentSkillRepo: undefined });
    const svc = new OrchestratorService(deps as never);

    await (svc as unknown as { updateSkillMetrics: (runId: string, success: boolean) => Promise<void> }).updateSkillMetrics(
      "run-1",
      true,
    );

    expect(eventRepo.findByRunId).not.toHaveBeenCalled();
  });

  it("updateSkillMetrics no-ops when there are no SKILL_INJECTION events for the run", async () => {
    const { deps, eventRepo, agentSkillRepo } = buildDeps();
    eventRepo.findByRunId.mockResolvedValue([]);

    const svc = new OrchestratorService(deps as never);
    await (svc as unknown as { updateSkillMetrics: (runId: string, success: boolean) => Promise<void> }).updateSkillMetrics(
      "run-1",
      true,
    );

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });

  it("updateSkillMetrics increments success and archives-if-low-utility for each deduplicated injected skill on a successful run", async () => {
    const { deps, eventRepo, agentSkillRepo } = buildDeps();
    const events: RunEventRecord[] = [
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1", "skill-2"] },
        createdAt: new Date(),
      },
      {
        id: "e2",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] }, // duplicate from a re-plan pass
        createdAt: new Date(),
      },
    ];
    eventRepo.findByRunId.mockResolvedValue(events);
    const updatedSkill = makeSkill({ id: "skill-1" });
    agentSkillRepo.incrementSuccess.mockResolvedValue(updatedSkill);

    const svc = new OrchestratorService(deps as never);
    await (svc as unknown as { updateSkillMetrics: (runId: string, success: boolean) => Promise<void> }).updateSkillMetrics(
      "run-1",
      true,
    );

    // skill-1 and skill-2, deduplicated, each incremented exactly once
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(updatedSkill);
  });

  it("updateSkillMetrics increments failure (not success) on a failed run", async () => {
    const { deps, eventRepo, agentSkillRepo } = buildDeps();
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] },
        createdAt: new Date(),
      },
    ]);
    agentSkillRepo.incrementFailure.mockResolvedValue(makeSkill());

    const svc = new OrchestratorService(deps as never);
    await (svc as unknown as { updateSkillMetrics: (runId: string, success: boolean) => Promise<void> }).updateSkillMetrics(
      "run-1",
      false,
    );

    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("logs a warning and continues when incrementing a skill's metric throws", async () => {
    const { deps, eventRepo, agentSkillRepo, logger } = buildDeps();
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1", "skill-2"] },
        createdAt: new Date(),
      },
    ]);
    agentSkillRepo.incrementSuccess.mockImplementation((id: string) => {
      if (id === "skill-1") return Promise.reject(new Error("db unavailable"));
      return Promise.resolve(makeSkill({ id }));
    });

    const svc = new OrchestratorService(deps as never);
    await (svc as unknown as { updateSkillMetrics: (runId: string, success: boolean) => Promise<void> }).updateSkillMetrics(
      "run-1",
      true,
    );

    // The failure for skill-1 is swallowed; skill-2 still gets processed.
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(1);

    const warnCall = logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Failed to update skill metric"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { skillId: string; error: string }).skillId).toBe("skill-1");
    expect((warnCall![0] as { skillId: string; error: string }).error).toBe("db unavailable");
  });
});

describe("OrchestratorService worktree cleanup on terminal transitions", () => {
  it("removes the worktree when the run's workingDirectory differs from the main repo path (via approveHumanReview -> Done)", async () => {
    const { deps, gitService, runRepo } = buildDeps();
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/repo/.worktrees/run-1" });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockImplementation((_id: string, state: RunState) =>
      Promise.resolve({ ...run, state }),
    );
    gitService.resolveMainRepoPath.mockReturnValue("/repo");

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).toHaveBeenCalledWith("/repo", "/repo/.worktrees/run-1");
  });

  it("does NOT remove the worktree when workingDirectory already equals the main repo path", async () => {
    const { deps, gitService, runRepo } = buildDeps();
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/repo" });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockImplementation((_id: string, state: RunState) =>
      Promise.resolve({ ...run, state }),
    );
    gitService.resolveMainRepoPath.mockReturnValue("/repo");

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("does not run cleanup/metrics logic for a non-terminal transition", async () => {
    const { deps, gitService, eventRepo, runRepo } = buildDeps();
    const run = makeRun({ state: RunState.AIBlocked });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockImplementation((_id: string, state: RunState) =>
      Promise.resolve({ ...run, state }),
    );

    const svc = new OrchestratorService(deps as never);
    // RESET_TO_TODO from AIBlocked -> Todo (non-terminal)
    await (svc as unknown as {
      transitionAndRecord: (run: Run, event: RunEvent, source: string) => Promise<Run>;
    }).transitionAndRecord(run, RunEvent.RESET_TO_TODO, "test");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
    const injectionOrMetricEvents = eventRepo.create.mock.calls.filter(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RESET_TO_TODO,
    );
    expect(injectionOrMetricEvents.length).toBe(1);
  });
});
