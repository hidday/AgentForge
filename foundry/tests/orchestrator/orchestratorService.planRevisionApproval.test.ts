import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { buildDeps, createStore, makeArtifact, makePlan, makePlanReview, makeRun } from "./testSupport.js";

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, transitions PLAN_REVISED, updates planVersion, and posts a combined comment", async () => {
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 2 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
      makeArtifact({
        type: "PlanReview",
        version: 1,
        payloadJson: makePlanReview({ overallVerdict: "changes_requested" }),
      }),
    ]);
    const { deps, planReviserAgent, linearClient } = buildDeps(store);
    const revisedPlan = makePlan({ planVersion: 3, summary: "Revised summary" });
    planReviserAgent.run.mockResolvedValue({
      revision: {
        dispositions: [{ findingId: "f1", status: "accepted", rationale: "Fixed as suggested" }],
      },
      revisedPlan,
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(store.run.planVersion).toBe(3);

    const revisedEvent = store.events.find((e) => e.eventType === (RunEvent.PLAN_REVISED as string));
    expect(revisedEvent).toBeDefined();

    const comment = linearClient.postComment.mock.calls[0][1] as string;
    expect(comment).toContain("Revised summary");
    expect(comment).toContain("Plan Revision Dispositions");
    expect(comment).toContain("Fixed as suggested");
  });

  it("passes opts.note through to planReviserAgent.run as operatorNote", async () => {
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
      makeArtifact({ type: "PlanReview", version: 1, payloadJson: makePlanReview() }),
    ]);
    const { deps, planReviserAgent } = buildDeps(store);
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanRevision("run-1", { note: "please tighten scope" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "please tighten scope" },
    );
  });

  it("passes undefined options to planReviserAgent.run when no note is given", async () => {
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
      makeArtifact({ type: "PlanReview", version: 1, payloadJson: makePlanReview() }),
    ]);
    const { deps, planReviserAgent } = buildDeps(store);
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("sets approvedPlanVersion, transitions PLAN_APPROVED, and posts an approval comment without a note", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2, approvedPlanVersion: null });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
    ]);
    const { deps, linearClient } = buildDeps(store);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approvePlan("run-1");

    expect(result.state).toBe(RunState.Implementing);
    expect(store.run.approvedPlanVersion).toBe(2);

    const comment = linearClient.postComment.mock.calls[0][1] as string;
    expect(comment).toBe("Plan v2 approved. Starting implementation...");
  });

  it("includes the operator note in the approval comment and the transition payload", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1, approvedPlanVersion: null });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, linearClient } = buildDeps(store);

    const svc = new OrchestratorService(deps as never);
    await svc.approvePlan("run-1", { note: "prioritize backward compatibility" });

    const comment = linearClient.postComment.mock.calls[0][1] as string;
    expect(comment).toContain("Plan v1 approved with operator note. Starting implementation...");
    expect(comment).toContain("prioritize backward compatibility");

    const approvedEvent = store.events.find((e) => e.eventType === (RunEvent.PLAN_APPROVED as string));
    expect((approvedEvent!.payloadJson as { note?: string }).note).toBe(
      "prioritize backward compatibility",
    );
  });

  it("throws when there is no Plan artifact for the run", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const store = createStore(run, []);
    const { deps } = buildDeps(store);

    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("throws when the run does not exist", async () => {
    const store = createStore(makeRun());
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("missing-run")).rejects.toThrow("Run not found: missing-run");
  });
});
