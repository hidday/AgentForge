import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import {
  makeRun,
  makePlan,
  makeArtifact,
  buildFullDeps,
} from "./testHelpers.js";

describe("OrchestratorService.approvePlan", () => {
  it("throws when no plan artifact exists for the run", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const built = buildFullDeps({ run, artifacts: [] });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("sets approvedPlanVersion to the latest plan's version and transitions to Implementing", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 });
    const plan = makePlan({ planVersion: 3 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 3, payloadJson: plan })],
    });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approvePlan("run-1");

    expect(result.state).toBe(RunState.Implementing);
    expect(built.runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 3 });

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.PLAN_APPROVED);
  });

  it("posts a plain approval comment when no operator note is given", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 2, payloadJson: plan })],
    });
    const svc = new OrchestratorService(built.deps as never);

    await svc.approvePlan("run-1");

    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      "Plan v2 approved. Starting implementation...",
    );
  });

  it("includes the operator note (blockquoted) in the approval comment when provided", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 2, payloadJson: plan })],
    });
    const svc = new OrchestratorService(built.deps as never);

    await svc.approvePlan("run-1", { note: "Please use the new auth lib" });

    const comment = built.linearClient.postComment.mock.calls[0]?.[1] as string;
    expect(comment).toContain("approved with operator note");
    expect(comment).toContain("> Please use the new auth lib");
  });

  it("records the PLAN_APPROVED event with the operator note in the payload", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
    });
    const svc = new OrchestratorService(built.deps as never);

    await svc.approvePlan("run-1", { note: "Use OAuth" });

    const approvalEvent = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.PLAN_APPROVED,
    );
    expect(approvalEvent).toBeDefined();
    expect(
      (approvalEvent![0] as { payloadJson: Record<string, unknown> }).payloadJson,
    ).toMatchObject({ note: "Use OAuth" });
  });

  it("throws when the run does not exist", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildFullDeps({ run });
    built.runRepo.findById.mockResolvedValueOnce(null);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.approvePlan("missing-run")).rejects.toThrow("Run not found: missing-run");
  });

  it("propagates a StateTransitionError when the run is not in a state that allows PLAN_APPROVED", async () => {
    // Todo state has no PLAN_APPROVED transition registered.
    const run = makeRun({ state: RunState.Todo, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
    });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(
      /No transition from state "Todo" for event "PLAN_APPROVED"/,
    );
  });
});
