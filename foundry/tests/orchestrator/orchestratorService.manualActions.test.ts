import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import {
  buildDeps,
  makeRun,
  makePlan,
  makePlanReview,
  makeArtifact,
} from "./orchestratorServiceTestHelpers.js";

function runAwaitingApproval(overrides: Record<string, unknown> = {}) {
  return makeRun({ state: RunState.AwaitingPlanApproval, ...overrides });
}

describe("OrchestratorService.runManualReReview", () => {
  it("returns to AwaitingPlanApproval when the reviewer approves", async () => {
    const { deps, artifactRepo, planReviewerAgent } = buildDeps({}, runAwaitingApproval());
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan() }),
    );
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runManualReReview("run-1", { note: "double check security" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "double check security" },
    );
  });

  it("still returns to AwaitingPlanApproval when the reviewer requests changes (human stays in control)", async () => {
    const { deps, artifactRepo, planReviewerAgent } = buildDeps({}, runAwaitingApproval());
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan() }),
    );
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "gap", title: "Missing step", details: "x" },
        ],
      }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("throws when no plan artifact exists", async () => {
    const { deps } = buildDeps({}, runAwaitingApproval());
    const svc = new OrchestratorService(deps as never);
    await expect(svc.runManualReReview("run-1")).rejects.toThrow("No plan artifact found");
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("records approval without revising when the reviewer approves", async () => {
    const { deps, artifactRepo, planReviewerAgent } = buildDeps({}, runAwaitingApproval());
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan() }),
    );
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(deps as never);
    const revisionSpy = vi.spyOn(svc, "runPlanRevision");

    const result = await svc.runManualPlanRevision("run-1");

    expect(revisionSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("delegates to runPlanRevision when the reviewer requests changes", async () => {
    const { deps, artifactRepo, planReviewerAgent } = buildDeps({}, runAwaitingApproval());
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan() }),
    );
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "gap", title: "Missing step", details: "x" },
        ],
      }),
    );
    const svc = new OrchestratorService(deps as never);
    const revisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(revisionSpy).toHaveBeenCalledWith("run-1", { note: "tighten scope" });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("throws when no plan artifact exists", async () => {
    const { deps } = buildDeps({}, runAwaitingApproval());
    const svc = new OrchestratorService(deps as never);
    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow("No plan artifact found");
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, then transitions to Done and notifies Linear", async () => {
    const { deps, linearClient, distillationAgent } = buildDeps(
      {},
      makeRun({ state: RunState.ReadyForHumanReview }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    expect(result.state).toBe(RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("Done"),
    );
  });

  it("completes the run even when distillation throws (best-effort)", async () => {
    const { deps, logger, distillationAgent } = buildDeps(
      {},
      makeRun({ state: RunState.ReadyForHumanReview }),
    );
    distillationAgent.run.mockRejectedValue(new Error("distillation boom"));
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      expect.stringContaining("Distillation agent failed"),
    );
  });
});
