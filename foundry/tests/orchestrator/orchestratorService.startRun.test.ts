import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { buildDeps, makeRun, makePlan } from "./orchestratorServiceTestHelpers.js";

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating a new one", async () => {
    const { deps, runRepo, linearClient } = buildDeps();
    const existing = makeRun({ id: "run-existing", state: RunState.Planning });
    runRepo.findActiveByIssueId.mockResolvedValue(existing);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(runRepo.create).not.toHaveBeenCalled();
    expect(linearClient.getIssue).not.toHaveBeenCalled();
  });

  it("creates a run, sets up a worktree, plans, and proceeds to plan review when there are no blocking questions", async () => {
    const { deps, runRepo, gitService, plannerAgent } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    const result = await svc.startRun("LIN-1");

    expect(runRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ linearIssueId: "LIN-1", repo: "test-repo" }),
    );
    expect(gitService.setupRunWorktree).toHaveBeenCalled();
    expect(reviewSpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.PlanReview);
  });

  it("pauses for human clarification when the plan has blocking open questions, without calling plan review", async () => {
    const { deps, runRepo, plannerAgent } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(
      makePlan({
        openQuestions: [{ id: "q1", question: "What auth method?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.startRun("LIN-1");

    expect(reviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });

  it("records a RUN_REQUESTED transition before planning", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.startRun("LIN-1");

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: RunEvent.RUN_REQUESTED }),
    );
  });
});
