import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import {
  buildStoreDeps,
  makeRun,
  makePlan,
  makePlanReview,
  makeArtifact,
  wirePlannerAgent,
  wirePlanReviewerAgent,
  wirePlanReviserAgent,
} from "./fixtures.js";

describe("OrchestratorService.runPlanReview", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.PlanReview });
    const { deps } = buildStoreDeps(initialRun);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("approved verdict transitions to AwaitingPlanApproval and posts an approval comment", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 2 });
    const { deps, store, planReviewerAgent, artifactRepo, linearClient } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () => makePlanReview({ overallVerdict: "approved" }));

    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(store.events.map((e) => e.eventType)).toContain(RunEvent.PLAN_REVIEW_APPROVED);
    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[1]).includes("approved"),
    );
    expect(comment).toBeDefined();
  });

  it("changes_requested verdict posts findings and chains into runPlanRevision", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 2 });
    const { deps, store, planReviewerAgent, planReviserAgent, artifactRepo, linearClient } = buildStoreDeps(
      initialRun,
      [makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) })],
    );
    const svc = new OrchestratorService(deps as never);

    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () =>
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "gap", title: "Missing step", details: "x" }],
      }),
    );
    wirePlanReviserAgent(artifactRepo, planReviserAgent, (plan) => makePlan({ ...plan, planVersion: plan.planVersion + 1 }));

    const result = await svc.runPlanReview("run-1");

    expect(planReviserAgent.run).toHaveBeenCalled();
    expect(store.events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining([RunEvent.PLAN_REVIEW_CHANGES_REQUESTED, RunEvent.PLAN_REVISED]),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const findingsComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[1]).includes("Changes Requested"),
    );
    expect(findingsComment).toBeDefined();
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, records PLAN_REVISED, and posts plan + disposition comments", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.PlanRevision, planVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    const planReview = makePlanReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "Missing step", details: "x" }],
    });
    const { deps, store, planReviserAgent, linearClient } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: plan }),
      makeArtifact({ type: "PlanReview", version: 1, payloadJson: planReview }),
    ]);
    const svc = new OrchestratorService(deps as never);

    const revisedPlan = makePlan({ planVersion: 3 });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "addressed", rationale: "fixed it" }] },
      revisedPlan,
    });

    const result = await svc.runPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(plan, planReview, expect.anything(), "run-1", undefined);
    expect(store.run.planVersion).toBe(3);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(store.events.map((e) => e.eventType)).toContain(RunEvent.PLAN_REVISED);

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[1]).includes("Plan Revision Dispositions"),
    );
    expect(comment).toBeDefined();
    expect(comment![1]).toContain("fixed it");
  });

  it("passes an operatorNote through to the plan reviser when provided", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.PlanRevision, planVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    const planReview = makePlanReview({ overallVerdict: "changes_requested", findings: [] });
    const { deps, planReviserAgent } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: plan }),
      makeArtifact({ type: "PlanReview", version: 1, payloadJson: planReview }),
    ]);
    const svc = new OrchestratorService(deps as never);

    const revisedPlan = makePlan({ planVersion: 3 });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan,
    });

    await svc.runPlanRevision("run-1", { note: "please reconsider step 2" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      "run-1",
      { operatorNote: "please reconsider step 2" },
    );
  });
});
