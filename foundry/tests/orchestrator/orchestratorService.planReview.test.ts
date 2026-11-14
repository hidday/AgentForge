import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { buildDeps, makeRun, makePlan, makePlanReview } from "./orchestratorTestHelpers.js";

describe("OrchestratorService.runPlanReview", () => {
  it("throws when there is no Plan artifact", async () => {
    const { deps, artifactRepo } = buildDeps();
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("transitions to AwaitingPlanApproval and posts a comment when the plan is approved", async () => {
    const { deps, runRepo, linearClient, planReviewerAgent } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.PlanReview }));
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(deps as never);

    const run = await svc.runPlanReview("run-1");

    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("approved"),
    );
  });

  it("transitions to PlanRevision and delegates to runPlanRevision when changes are requested", async () => {
    const { deps, runRepo, planReviewerAgent } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.PlanReview }));
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "clarity",
            title: "t",
            details: "d",
            affectedStepId: "s1",
          },
        ],
      }),
    );
    const svc = new OrchestratorService(deps as never);
    const runPlanRevisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const run = await svc.runPlanReview("run-1");

    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1");
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, bumps planVersion, and transitions to AwaitingPlanApproval", async () => {
    const { deps, runRepo, planReviserAgent, linearClient } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.PlanRevision, planVersion: 1 }));
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "fixed" }] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });
    const svc = new OrchestratorService(deps as never);

    const run = await svc.runPlanRevision("run-1");

    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Revised after AI review"),
    );
  });

  it("passes an operator note through to the plan reviser agent", async () => {
    const { deps, runRepo, planReviserAgent } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.PlanRevision }));
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanRevision("run-1", { note: "please simplify" });

    const call = planReviserAgent.run.mock.calls[0];
    expect(call[3]).toBe("run-1");
    expect(call[4]).toEqual({ operatorNote: "please simplify" });
  });

  it("calls the plan reviser agent with undefined options when there is no note", async () => {
    const { deps, runRepo, planReviserAgent } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.PlanRevision }));
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanRevision("run-1");

    const call = planReviserAgent.run.mock.calls[0];
    expect(call[3]).toBe("run-1");
    expect(call[4]).toBeUndefined();
  });
});
