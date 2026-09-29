import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import {
  buildStorefulDeps,
  makeRun,
  makePlan,
  makePlanReview,
  stubPlanReviser,
} from "./helpers/testKit.js";

describe("OrchestratorService.runPlanReview", () => {
  it("approves the plan and posts an approval comment", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({ planVersion: 1 }),
    });
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("AI plan review: approved"),
    );
  });

  it("throws when there is no Plan artifact", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview });
    const h = buildStorefulDeps(run);
    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("requests changes and chains into runPlanRevision, posting the revised plan comment", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({ planVersion: 1 }),
    });
    h.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "gap",
            title: "Missing test",
            details: "Add a test",
          },
        ],
      }),
    );

    const revisedPlan = makePlan({ planVersion: 2 });
    stubPlanReviser(h, revisedPlan, {
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "plan-review-1",
      dispositions: [{ findingId: "f1", status: "accepted", rationale: "Added the test" }],
    });

    const svc = new OrchestratorService(h.deps as never);
    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.planReviserAgent.run).toHaveBeenCalledTimes(1);
    const comments = h.linearClient.postComment.mock.calls.map((c: unknown[]) => c[1]);
    expect(comments.some((c) => typeof c === "string" && c.includes("Revised after AI review"))).toBe(
      true,
    );
    expect(
      comments.some(
        (c) => typeof c === "string" && c.includes("Plan Revision Dispositions"),
      ),
    ).toBe(true);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("passes an operator note through to the plan reviser when provided", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanRevision, planVersion: 1 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({ planVersion: 1 }),
    });
    await h.artifactRepo.create({
      runId: "run-1",
      type: "PlanReview",
      version: 1,
      payloadJson: makePlanReview({ overallVerdict: "changes_requested" }),
    });

    const revisedPlan = makePlan({ planVersion: 2 });
    stubPlanReviser(h, revisedPlan, {
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "plan-review-1",
      dispositions: [],
    });

    const svc = new OrchestratorService(h.deps as never);
    await svc.runPlanRevision("run-1", { note: "please simplify" });

    expect(h.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "please simplify" },
    );
  });

  it("passes undefined options when no note is provided", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanRevision, planVersion: 1 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({ planVersion: 1 }),
    });
    await h.artifactRepo.create({
      runId: "run-1",
      type: "PlanReview",
      version: 1,
      payloadJson: makePlanReview({ overallVerdict: "changes_requested" }),
    });

    stubPlanReviser(h, makePlan({ planVersion: 2 }), {
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "plan-review-1",
      dispositions: [],
    });

    const svc = new OrchestratorService(h.deps as never);
    await svc.runPlanRevision("run-1");

    expect(h.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("returns to AwaitingPlanApproval when the reviewer approves", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({ planVersion: 1 }),
    });
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    const result = await svc.runManualReReview("run-1", { note: "double check X" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "double check X" },
    );
  });

  it("returns to AwaitingPlanApproval (not PlanRevision) even when the reviewer requests changes", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({ planVersion: 1 }),
    });
    h.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({ overallVerdict: "changes_requested" }),
    );

    const svc = new OrchestratorService(h.deps as never);
    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("throws when there is no Plan artifact", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const h = buildStorefulDeps(run);
    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("stays approved without revision when the reviewer approves", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({ planVersion: 1 }),
    });
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("revises the plan when the reviewer requests changes, forwarding the operator note", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({ planVersion: 1 }),
    });
    h.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({ overallVerdict: "changes_requested" }),
    );
    // runPlanRevision (invoked internally) needs a PlanReview artifact to read.
    await h.artifactRepo.create({
      runId: "run-1",
      type: "PlanReview",
      version: 1,
      payloadJson: makePlanReview({ overallVerdict: "changes_requested" }),
    });

    stubPlanReviser(h, makePlan({ planVersion: 2 }), {
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "plan-review-1",
      dispositions: [],
    });

    const svc = new OrchestratorService(h.deps as never);
    const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "tighten scope" },
    );
  });

  it("throws when there is no Plan artifact", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const h = buildStorefulDeps(run);
    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});
