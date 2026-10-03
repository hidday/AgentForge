import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { buildDeps, makeRun, makeArtifact, makePlan } from "./_fixtures.js";

describe("OrchestratorService -- skill retrieval/metrics (exercised via startRun/rejectPlan)", () => {
  it("retrieveSkillsForPlanning: queries by repo + title/description and records SKILL_INJECTION when skills are found", async () => {
    const { deps, runRepo, artifactRepo, agentSkillRepo, eventRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ state: RunState.Todo, linearIssueTitle: "Fix bug" });
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(todoRun);
    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" })
      .mockResolvedValue(makeRun({ state: RunState.Planning }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));
    // requireRun() inside runPlanReview() looks the run up again by id.
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Fix bug", description: "A real bug", branchName: "ai/lin-1", labels: [], priority: 0,
    });
    (deps.repoRegistry.resolveForIssue as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "test-repo", defaultBranch: "main", allowedPaths: ["src/"], protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    });
    (deps.repoRegistry.resolveWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue("/tmp");
    (deps.repoRegistry.validateWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const skill = {
      id: "skill-1", repoSlug: "test-repo", name: "n", description: "d",
      taskCategory: "testing", skillMarkdown: "md", utilityScore: 0.5, lastUsedAt: new Date(),
    };
    agentSkillRepo.findTopKByRelevance.mockResolvedValue([skill]);

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() })) : Promise.resolve(null),
    );
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] });

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Fix bug"),
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

  it("retrieveSkillsForPlanning: returns [] and records no event when agentSkillRepo is not configured", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent, planReviewerAgent } = buildDeps({
      agentSkillRepo: undefined,
    });
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ state: RunState.Todo });
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(todoRun);
    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" })
      .mockResolvedValue(makeRun({ state: RunState.Planning }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Fix bug", description: "desc", branchName: "ai/lin-1", labels: [], priority: 0,
    });
    (deps.repoRegistry.resolveForIssue as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "test-repo", defaultBranch: "main", allowedPaths: ["src/"], protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    });
    (deps.repoRegistry.resolveWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue("/tmp");
    (deps.repoRegistry.validateWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() })) : Promise.resolve(null),
    );
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] });

    await svc.startRun("LIN-1");

    const injectionEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvent).toBeUndefined();
  });
});

describe("OrchestratorService -- updateSkillMetrics (exercised via a terminal transition)", () => {
  it("increments success for every unique injected skill id when the run reaches Done", async () => {
    const { deps, runRepo, artifactRepo, agentSkillRepo, eventRepo, distillationAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    distillationAgent.run.mockResolvedValue(undefined);

    eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["s1", "s2"] }, createdAt: new Date() },
      { id: "e2", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["s2"] }, createdAt: new Date() },
    ]);

    const updatedSkill = { id: "s1", successCount: 1, failureCount: 0, utilityScore: 1 };
    agentSkillRepo.incrementSuccess.mockResolvedValue(updatedSkill);

    await svc.approveHumanReview("run-1");

    // Deduplicated: s1 and s2 only, each incremented exactly once.
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("s1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("s2");
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(updatedSkill);
    expect(artifactRepo).toBeDefined();
  });

  it("logs a warning and continues when updating a skill metric throws", async () => {
    const { deps, runRepo, agentSkillRepo, eventRepo, distillationAgent, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    distillationAgent.run.mockResolvedValue(undefined);

    eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["s1"] }, createdAt: new Date() },
    ]);
    agentSkillRepo.incrementSuccess.mockRejectedValue(new Error("db down"));

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "s1", error: "db down" }),
      "Failed to update skill metric",
    );
  });

  it("does nothing when there are no SKILL_INJECTION events", async () => {
    const { deps, runRepo, agentSkillRepo, eventRepo, distillationAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    distillationAgent.run.mockResolvedValue(undefined);
    eventRepo.findByRunId.mockResolvedValue([]);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService -- cleanupRunWorktree (exercised via a terminal transition)", () => {
  it("removes the worktree when the run's working directory differs from the main repo path", async () => {
    const { deps, runRepo, gitService, distillationAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/repo/.worktrees/run-1" });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(
      makeRun({ state: RunState.Done, workingDirectory: "/repo/.worktrees/run-1" }),
    );
    distillationAgent.run.mockResolvedValue(undefined);
    gitService.resolveMainRepoPath.mockReturnValue("/repo");

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).toHaveBeenCalledWith("/repo", "/repo/.worktrees/run-1");
  });

  it("does not remove the worktree when the working directory equals the main repo path", async () => {
    const { deps, runRepo, gitService, distillationAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/repo" });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done, workingDirectory: "/repo" }));
    distillationAgent.run.mockResolvedValue(undefined);
    gitService.resolveMainRepoPath.mockReturnValue("/repo");

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("also cleans up when a run transitions to Failed (e.g. clarification exhausted)", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent, gitService } = buildDeps({
      answerResearcherAgent: undefined,
    });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded, workingDirectory: "/repo/.worktrees/run-1" });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    gitService.resolveMainRepoPath.mockReturnValue("/repo");

    const plan = makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan"
        ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }))
        : type === "TaskBundle"
          ? Promise.resolve(makeArtifact({ type: "TaskBundle", payloadJson: { issue: {}, repo: {}, constraints: {}, definitionOfDone: [] } }))
          : Promise.resolve(null),
    );
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }] }),
    );
    eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e2", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e3", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
    ]);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.Failed, workingDirectory: "/repo/.worktrees/run-1" }));

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unsure" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(gitService.removeWorktree).toHaveBeenCalledWith("/repo", "/repo/.worktrees/run-1");
  });
});
