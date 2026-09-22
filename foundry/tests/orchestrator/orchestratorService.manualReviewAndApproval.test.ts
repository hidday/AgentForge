import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { buildDeps, createStore, makeArtifact, makePlan, makePlanReview, makeRun } from "./testSupport.js";

describe("OrchestratorService.runManualReReview", () => {
  it("records RE_REVIEW_REQUESTED with trigger 're-review' and returns to AwaitingPlanApproval when the reviewer approves", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, planReviewerAgent } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const reReviewEvent = store.events.find(
      (e) => e.eventType === (RunEvent.RE_REVIEW_REQUESTED as string),
    );
    expect((reReviewEvent!.payloadJson as { trigger: string }).trigger).toBe("re-review");
    expect((reReviewEvent!.payloadJson as { note?: string }).note).toBeUndefined();
  });

  it("still returns to AwaitingPlanApproval (not PlanRevision) when the reviewer requests changes", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, planReviewerAgent, planReviserAgent } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({ overallVerdict: "changes_requested", findings: [{ id: "f1", severity: "nit", type: "x", title: "t", details: "d" }] }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("includes the operator note in the RE_REVIEW_REQUESTED payload and forwards it to planReviewerAgent.run", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, planReviewerAgent } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(deps as never);
    await svc.runManualReReview("run-1", { note: "double-check rate limits" });

    const reReviewEvent = store.events.find(
      (e) => e.eventType === (RunEvent.RE_REVIEW_REQUESTED as string),
    );
    expect((reReviewEvent!.payloadJson as { note?: string }).note).toBe("double-check rate limits");
    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "double-check rate limits" },
    );
  });

  it("throws when there is no Plan artifact", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const store = createStore(run, []);
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("on approved verdict: transitions PLAN_REVIEW_APPROVED and does not call runPlanRevision", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, planReviewerAgent } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(deps as never);
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision");

    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(runPlanRevisionSpy).not.toHaveBeenCalled();
  });

  it("on changes_requested verdict: transitions PLAN_REVIEW_CHANGES_REQUESTED then delegates to runPlanRevision with the note", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, planReviewerAgent } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "x", title: "t", details: "d" }],
      }),
    );
    const svc = new OrchestratorService(deps as never);
    const runPlanRevisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const result = await svc.runManualPlanRevision("run-1", { note: "focus on findings" });

    const changesEvent = store.events.find(
      (e) => e.eventType === (RunEvent.PLAN_REVIEW_CHANGES_REQUESTED as string),
    );
    expect(changesEvent).toBeDefined();
    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1", { note: "focus on findings" });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("passes undefined to runPlanRevision when no note is given", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, planReviewerAgent } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "changes_requested", findings: [{ id: "f1", severity: "nit", type: "x", title: "t", details: "d" }] }));
    const svc = new OrchestratorService(deps as never);
    const runPlanRevisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.runManualPlanRevision("run-1");

    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1", undefined);
  });

  it("throws when there is no Plan artifact", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const store = createStore(run, []);
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions HUMAN_APPROVED, and posts the completion comment", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const store = createStore(run, []);
    const { deps, linearClient } = buildDeps(store);
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
    const svc = new OrchestratorService({ ...deps, distillationAgent } as never);

    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    expect(result.state).toBe(RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Human review approved. Run is **Done**.",
    );
  });

  it("tolerates a missing distillationAgent (optional dependency)", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const store = createStore(run, []);
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });

  it("swallows a distillationAgent failure (best-effort) and still completes the run", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const store = createStore(run, []);
    const { deps, logger } = buildDeps(store);
    const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("distillation blew up")) };
    const svc = new OrchestratorService({ ...deps, distillationAgent } as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation blew up" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("stringifies a non-Error thrown by distillationAgent in the warning log", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const store = createStore(run, []);
    const { deps, logger } = buildDeps(store);
    const distillationAgent = { run: vi.fn().mockRejectedValue("plain string failure") };
    const svc = new OrchestratorService({ ...deps, distillationAgent } as never);

    await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "plain string failure" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("throws when the run does not exist", async () => {
    const store = createStore(makeRun());
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approveHumanReview("missing-run")).rejects.toThrow("Run not found: missing-run");
  });
});
