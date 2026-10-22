import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, RunEventRecord } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "title",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/worktree",
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "evt-1",
    runId: "run-1",
    eventType: "SKILL_INJECTION",
    source: "orchestrator",
    payloadJson: {},
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Minimal OrchestratorService harness: every dependency is a bare vi.fn()
 * stub, and callers override only what their scenario needs. This is much
 * lighter than the full orchestratorService.lifecycle.test.ts harness and is
 * intentionally scoped to a handful of still-uncovered guard clauses and
 * branches rather than full run lifecycles.
 */
function makeService(run: Run, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn().mockResolvedValue(run),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) =>
      Promise.resolve({ ...run, state: newState }),
    ),
    update: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findByIssueId: vi.fn(),
  };
  const artifactRepo = {
    findLatestByType: vi.fn().mockResolvedValue(null),
    findByRunId: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
  };
  const eventRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue(makeEvent()),
  };
  const linearClient = { getIssue: vi.fn(), postComment: vi.fn().mockResolvedValue(undefined) };
  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };
  const gitService = {
    resolveMainRepoPath: vi.fn().mockReturnValue(run.workingDirectory),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
  };
  const repoRegistry = { getRepoByName: vi.fn(), getDefaultRepo: vi.fn() };
  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const deps = {
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    gitService,
    repoRegistry,
    linearSync,
    githubSync,
    plannerAgent: { run: vi.fn() },
    planReviewerAgent: { run: vi.fn() },
    planReviserAgent: { run: vi.fn() },
    executorAgent: { run: vi.fn() },
    reviewerAgent: { run: vi.fn() },
    remediationAgent: { run: vi.fn() },
    logger,
    ...overrides,
  };

  const service = new OrchestratorService(deps as never);
  return { service, ...deps };
}

describe("OrchestratorService.answerQuestions — missing plan artifact", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const { service } = makeService(run);

    await expect(
      service.answerQuestions(run.id, [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(`No plan artifact found for run ${run.id}`);
  });
});

describe("OrchestratorService.runManualPlanRevision — missing plan artifact", () => {
  it("records the RE_REVIEW_REQUESTED transition and then throws when no Plan artifact exists", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const { service, eventRepo } = makeService(run);

    await expect(service.runManualPlanRevision(run.id)).rejects.toThrow(
      `No plan artifact found for run ${run.id}`,
    );

    // The state transition is recorded before the guard fires.
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ runId: run.id, eventType: "RE_REVIEW_REQUESTED" }),
    );
  });
});

describe("OrchestratorService.approveHumanReview — Done-state cleanup", () => {
  it("skips worktree removal when the run's workingDirectory is not a worktree", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/repo/main" });
    const { service, gitService } = makeService(run);
    gitService.resolveMainRepoPath.mockReturnValue("/repo/main");

    await service.approveHumanReview(run.id);

    expect(gitService.resolveMainRepoPath).toHaveBeenCalledWith("/repo/main");
    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("removes the worktree when the run's workingDirectory resolves to a different main repo path", async () => {
    const run = makeRun({
      state: RunState.ReadyForHumanReview,
      workingDirectory: "/repo/.worktrees/run-1",
    });
    const { service, gitService } = makeService(run);
    gitService.resolveMainRepoPath.mockReturnValue("/repo");

    await service.approveHumanReview(run.id);

    expect(gitService.removeWorktree).toHaveBeenCalledWith("/repo", "/repo/.worktrees/run-1");
  });

  it("logs a warning and continues when updating a skill's metrics fails", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const injectionEvent = makeEvent({
      eventType: "SKILL_INJECTION",
      payloadJson: { skillIds: ["skill-1"] },
    });
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockRejectedValue(new Error("db unavailable")),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { service, eventRepo, logger } = makeService(run, { agentSkillRepo });
    eventRepo.findByRunId.mockResolvedValue([injectionEvent]);

    const result = await service.approveHumanReview(run.id);

    expect(result.state).toBe(RunState.Done);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.archiveIfLowUtility).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: run.id, skillId: "skill-1", error: "db unavailable" }),
      "Failed to update skill metric",
    );
  });

  it("increments success and archives-if-low-utility for every injected skill on a successful run", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const injectionEvent = makeEvent({
      eventType: "SKILL_INJECTION",
      payloadJson: { skillIds: ["skill-1", "skill-2"] },
    });
    const updatedSkill = { id: "skill-1" };
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockResolvedValue(updatedSkill),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { service, eventRepo } = makeService(run, { agentSkillRepo });
    eventRepo.findByRunId.mockResolvedValue([injectionEvent]);

    await service.approveHumanReview(run.id);

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(updatedSkill);
  });
});

describe("OrchestratorService.updateSkillMetrics (invoked directly)", () => {
  // `updateSkillMetrics` is private; it reads `this.agentSkillRepo`,
  // `this.eventRepo`, and `this.logger` but needs no full service instance,
  // so we call it directly via `.call(fakeThis, ...)` to exercise its
  // remaining branches without driving a full run lifecycle.
  type Updater = {
    updateSkillMetrics(runId: string, success: boolean): Promise<void>;
  };
  const updateSkillMetrics = (
    OrchestratorService.prototype as unknown as Updater
  ).updateSkillMetrics;

  it("does nothing when there are no SKILL_INJECTION events for the run", async () => {
    const agentSkillRepo = {
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const eventRepo = { findByRunId: vi.fn().mockResolvedValue([makeEvent({ eventType: "OTHER" })]) };
    const fakeThis = { agentSkillRepo, eventRepo, logger: { warn: vi.fn() } };

    await updateSkillMetrics.call(fakeThis, "run-1", true);

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });

  it("calls incrementFailure (not incrementSuccess) for every injected skill when success is false", async () => {
    const injectionEvent = makeEvent({
      eventType: "SKILL_INJECTION",
      payloadJson: { skillIds: ["skill-1"] },
    });
    const updatedSkill = { id: "skill-1" };
    const agentSkillRepo = {
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockResolvedValue(updatedSkill),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const eventRepo = { findByRunId: vi.fn().mockResolvedValue([injectionEvent]) };
    const fakeThis = { agentSkillRepo, eventRepo, logger: { warn: vi.fn() } };

    await updateSkillMetrics.call(fakeThis, "run-1", false);

    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(updatedSkill);
  });
});
