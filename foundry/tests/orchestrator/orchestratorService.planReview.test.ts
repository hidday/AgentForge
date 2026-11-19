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

describe("OrchestratorService.runPlanReview", () => {
  it("throws when no plan artifact exists", async () => {
    const { deps } = buildDeps({}, makeRun({ state: RunState.PlanReview }));
    const svc = new OrchestratorService(deps as never);
    await expect(svc.runPlanReview("run-1")).rejects.toThrow("No plan artifact found");
  });

  it("transitions to AwaitingPlanApproval and posts a comment when the review is approved", async () => {
    const { deps, artifactRepo, linearClient, planReviewerAgent } = buildDeps(
      {},
      makeRun({ state: RunState.PlanReview }),
    );
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan() }),
    );
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("approved"),
    );
  });

  it("delegates to runPlanRevision when the review requests changes", async () => {
    const { deps, artifactRepo, planReviewerAgent } = buildDeps(
      {},
      makeRun({ state: RunState.PlanReview }),
    );
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan() }),
    );
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "gap", title: "Missing step", details: "..." },
        ],
      }),
    );
    const svc = new OrchestratorService(deps as never);
    const revisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const result = await svc.runPlanReview("run-1");

    expect(revisionSpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, bumps the plan version, and posts a combined comment", async () => {
    const { deps, runRepo, linearClient, artifactRepo, planReviserAgent } = buildDeps(
      {},
      makeRun({ state: RunState.PlanRevision, planVersion: 2 }),
    );
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "PlanReview")
        return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: makePlanReview() }));
      return Promise.resolve(null);
    });
    planReviserAgent.run.mockResolvedValue({
      revision: {
        dispositions: [{ findingId: "f1", status: "accepted", rationale: "Makes sense" }],
      },
      revisedPlan: makePlan({ planVersion: 3 }),
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runPlanRevision("run-1", { note: "please tighten scope" });

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 3 });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("Plan Revision Dispositions"),
    );
    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "please tighten scope" },
    );
  });

  it("passes undefined options to the reviser when no note is given", async () => {
    const { deps, artifactRepo, planReviserAgent } = buildDeps(
      {},
      makeRun({ state: RunState.PlanRevision }),
    );
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "PlanReview")
        return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: makePlanReview() }));
      return Promise.resolve(null);
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
  it("throws when no plan artifact exists", async () => {
    const { deps } = buildDeps({}, makeRun({ state: RunState.AwaitingPlanApproval }));
    const svc = new OrchestratorService(deps as never);
    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found");
  });

  it("records the approved plan version and transitions to Implementing", async () => {
    const { deps, runRepo, linearClient, artifactRepo } = buildDeps(
      {},
      makeRun({ state: RunState.AwaitingPlanApproval }),
    );
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approvePlan("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 1 });
    expect(result.state).toBe(RunState.Implementing);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("approved"),
    );
  });

  it("includes the operator note in the approval comment when provided", async () => {
    const { deps, linearClient, artifactRepo } = buildDeps(
      {},
      makeRun({ state: RunState.AwaitingPlanApproval }),
    );
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }),
    );
    const svc = new OrchestratorService(deps as never);

    await svc.approvePlan("run-1", { note: "ship it" });

    expect(linearClient.postComment).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("ship it"),
    );
  });
});
