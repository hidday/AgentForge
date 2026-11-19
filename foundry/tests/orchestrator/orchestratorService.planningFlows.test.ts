import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { buildDeps, makeRun, makePlan, makeArtifact } from "./orchestratorServiceTestHelpers.js";

describe("OrchestratorService.runPlanning", () => {
  it("re-plans using prior context artifacts and proceeds to plan review when unblocked", async () => {
    const { deps, artifactRepo, plannerAgent } = buildDeps(
      {},
      makeRun({ state: RunState.Planning, planVersion: 1 }),
    );
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ planVersionOverride: 2 }),
    );
    expect(reviewSpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.PlanReview);
  });

  it("pauses for clarification when the re-plan still has blocking questions", async () => {
    const { deps, plannerAgent } = buildDeps({}, makeRun({ state: RunState.Planning }));
    plannerAgent.run.mockResolvedValue(
      makePlan({
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.runPlanning("run-1");

    expect(reviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });

  it("throws when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    await expect(svc.runPlanning("missing")).rejects.toThrow("Run not found: missing");
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branch yet", async () => {
    const { deps, gitService, repoRegistry } = buildDeps(
      {},
      makeRun({ state: RunState.Todo, branchName: null }),
    );
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.retryRun("run-1");

    expect(repoRegistry.getRepoByName).toHaveBeenCalledWith("test-repo");
    expect(gitService.setupRunWorktree).toHaveBeenCalled();
  });

  it("skips worktree setup when the run already has a branch", async () => {
    const { deps, gitService } = buildDeps(
      {},
      makeRun({ state: RunState.Todo, branchName: "ai/existing" }),
    );
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for clarification when the fresh plan has blocking questions", async () => {
    const { deps, plannerAgent } = buildDeps(
      {},
      makeRun({ state: RunState.Todo, branchName: "ai/existing" }),
    );
    plannerAgent.run.mockResolvedValue(
      makePlan({
        openQuestions: [{ id: "q1", question: "Scope?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.retryRun("run-1");

    expect(reviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });

  it("proceeds to plan review on a clean re-plan", async () => {
    const { deps } = buildDeps({}, makeRun({ state: RunState.Todo, branchName: "ai/existing" }));
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    const result = await svc.retryRun("run-1");

    expect(reviewSpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.PlanReview);
  });
});
