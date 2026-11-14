import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { buildDeps, makeRun, makePlan } from "./orchestratorTestHelpers.js";

describe("OrchestratorService.retryRun", () => {
  it("re-establishes a worktree when the run has no branch yet", async () => {
    const { deps, runRepo, gitService } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.Todo, branchName: null }));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalled();
    expect(runRepo.update).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ workingDirectory: "/tmp/worktree", branchName: "ai/run-1" }),
    );
  });

  it("skips worktree setup when the run already has a branch", async () => {
    const { deps, runRepo, gitService } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.Todo, branchName: "ai/existing" }));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for human clarification when the fresh plan has blocking open questions", async () => {
    const { deps, runRepo, plannerAgent, eventRepo } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.Todo, branchName: "ai/x" }));
    plannerAgent.run.mockResolvedValue(
      makePlan({
        openQuestions: [{ id: "q1", question: "which auth?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const run = await svc.retryRun("run-1");

    expect(run.state).toBe(RunState.HumanClarificationNeeded);
    expect(runPlanReviewSpy).not.toHaveBeenCalled();
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
    );
  });

  it("proceeds straight to plan review when there are no blocking questions", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.Todo, branchName: "ai/x" }));
    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    const run = await svc.retryRun("run-1");

    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
    expect(run.state).toBe(RunState.PlanReview);
  });

  it("throws when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.setCurrent(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.retryRun("missing")).rejects.toThrow("Run not found: missing");
  });
});
