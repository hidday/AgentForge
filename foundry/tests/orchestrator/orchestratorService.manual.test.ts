import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { buildDeps, makeRun, makePlanReview } from "./orchestratorTestHelpers.js";

describe("OrchestratorService.runManualReReview", () => {
  it("returns to AwaitingPlanApproval when the reviewer approves", async () => {
    const { deps, runRepo, planReviewerAgent } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.AwaitingPlanApproval }));
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(deps as never);

    const run = await svc.runManualReReview("run-1");

    expect(run.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("still returns to AwaitingPlanApproval (not auto-chaining) when changes are requested", async () => {
    const { deps, runRepo, planReviewerAgent } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.AwaitingPlanApproval }));
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "changes_requested" }));
    const svc = new OrchestratorService(deps as never);

    const run = await svc.runManualReReview("run-1");

    expect(run.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("passes the operator note through as both transition metadata and reviewer input", async () => {
    const { deps, runRepo, eventRepo, planReviewerAgent } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.AwaitingPlanApproval }));
    const svc = new OrchestratorService(deps as never);

    await svc.runManualReReview("run-1", { note: "double check security" });

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadJson: expect.objectContaining({ trigger: "re-review", note: "double check security" }),
      }),
    );
    expect(planReviewerAgent.run.mock.calls[0][3]).toEqual({
      operatorNote: "double check security",
    });
  });

  it("throws when there is no Plan artifact", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("accepts the plan when the reviewer approves, without revising", async () => {
    const { deps, runRepo, planReviewerAgent } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.AwaitingPlanApproval }));
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(deps as never);
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision");

    const run = await svc.runManualPlanRevision("run-1");

    expect(runPlanRevisionSpy).not.toHaveBeenCalled();
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("delegates to runPlanRevision, forwarding the note, when changes are requested", async () => {
    const { deps, runRepo, planReviewerAgent } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.AwaitingPlanApproval }));
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "changes_requested" }));
    const svc = new OrchestratorService(deps as never);
    const runPlanRevisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const run = await svc.runManualPlanRevision("run-1", { note: "simplify step 2" });

    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1", { note: "simplify step 2" });
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("throws when there is no Plan artifact", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, and posts the completion comment", async () => {
    const { deps, runRepo, linearClient } = buildDeps({
      distillationAgent: { run: vi.fn().mockResolvedValue(undefined) },
    });
    runRepo.setCurrent(makeRun({ state: RunState.ReadyForHumanReview }));
    const svc = new OrchestratorService(deps as never);

    const run = await svc.approveHumanReview("run-1");

    expect(run.state).toBe(RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Done"),
    );
  });

  it("completes the run even when the distillation agent throws (best-effort)", async () => {
    const { deps, runRepo, logger } = buildDeps({
      distillationAgent: { run: vi.fn().mockRejectedValue(new Error("distillation crashed")) },
    });
    runRepo.setCurrent(makeRun({ state: RunState.ReadyForHumanReview }));
    const svc = new OrchestratorService(deps as never);

    const run = await svc.approveHumanReview("run-1");

    expect(run.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "distillation crashed" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("completes the run when no distillation agent is configured", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.ReadyForHumanReview }));
    const svc = new OrchestratorService(deps as never);

    const run = await svc.approveHumanReview("run-1");

    expect(run.state).toBe(RunState.Done);
  });

  it("cleans up the worktree and updates skill metrics when the run completes", async () => {
    const { deps, runRepo, gitService, eventRepo } = buildDeps({
      agentSkillRepo: {
        incrementSuccess: vi.fn().mockResolvedValue({ id: "skill-1", utilityScore: 0.5 }),
        incrementFailure: vi.fn(),
        archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
      },
    });
    runRepo.setCurrent(
      makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree" }),
    );
    gitService.resolveMainRepoPath.mockReturnValue("/tmp/main");
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
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).toHaveBeenCalledWith("/tmp/main", "/tmp/worktree");
    const skillRepo = (deps as unknown as { agentSkillRepo: { incrementSuccess: ReturnType<typeof vi.fn> } })
      .agentSkillRepo;
    expect(skillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
  });

  it("logs a warning and continues when updating a skill's metrics fails", async () => {
    const { deps, runRepo, eventRepo, logger } = buildDeps({
      agentSkillRepo: {
        incrementSuccess: vi.fn().mockRejectedValue(new Error("db down")),
        incrementFailure: vi.fn(),
        archiveIfLowUtility: vi.fn(),
      },
    });
    runRepo.setCurrent(makeRun({ state: RunState.ReadyForHumanReview }));
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
    const svc = new OrchestratorService(deps as never);

    const run = await svc.approveHumanReview("run-1");

    expect(run.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1", error: "db down" }),
      "Failed to update skill metric",
    );
  });
});
