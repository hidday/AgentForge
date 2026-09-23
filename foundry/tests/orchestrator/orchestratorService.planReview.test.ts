import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { buildFullDeps, makeRun, makePlan, makePlanReview } from "./_helpers/fixtures.js";

describe("OrchestratorService.runPlanReview", () => {
  it("throws when there is no Plan artifact", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview });
    const { deps } = buildFullDeps(run);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("approved verdict: transitions to AwaitingPlanApproval and posts an 'approved' comment", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview });
    const { deps, artifactRepo, planReviewerAgent, linearClient } = buildFullDeps(run);
    const plan = makePlan();
    artifactRepo.seed("Plan", plan);
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("AI plan review: approved"),
    );
  });

  it("changes_requested verdict: posts findings comment and chains into runPlanRevision", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 2 });
    const { deps, artifactRepo, planReviewerAgent, planReviserAgent, linearClient } =
      buildFullDeps(run);
    const plan = makePlan({ planVersion: 2 });
    artifactRepo.seed("Plan", plan);
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "gap",
            affectedStepId: "s1",
            title: "Missing edge case",
            details: "Consider retries",
          },
        ],
      }),
    );
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "addressed", rationale: "Added retry logic" }] },
      revisedPlan: makePlan({ planVersion: 3 }),
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanReview("run-1");

    // Posted the plan-review-changes-requested comment (contains the finding title)
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Missing edge case"),
    );
    expect(planReviserAgent.run).toHaveBeenCalled();
    // Ends in AwaitingPlanApproval after PlanRevision -> PLAN_REVISED
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("throws PolicyViolationError-shaped state error when run is not in PlanRevision state", async () => {
    // PlanRevision transition table only allows PLAN_REVISED from PlanRevision state.
    const run = makeRun({ id: "run-1", state: RunState.Todo });
    const { deps, artifactRepo } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan());
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanRevision("run-1")).rejects.toThrow(/No transition from state/);
  });

  it("revises the plan, updates run.planVersion, transitions to AwaitingPlanApproval, and posts a comment with dispositions", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanRevision, planVersion: 2 });
    const { deps, runRepo, artifactRepo, planReviserAgent, linearClient } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan({ planVersion: 2 }));
    artifactRepo.seed("PlanReview", makePlanReview({ overallVerdict: "changes_requested" }));
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "addressed", rationale: "Fixed" }] },
      revisedPlan: makePlan({ planVersion: 3 }),
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanRevision("run-1");

    expect(runRepo.getCurrent().planVersion).toBe(3);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Plan Revision Dispositions"),
    );
  });

  it("passes an operatorNote through to planReviserAgent.run when provided", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanRevision, planVersion: 2 });
    const { deps, artifactRepo, planReviserAgent } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan({ planVersion: 2 }));
    artifactRepo.seed("PlanReview", makePlanReview({ overallVerdict: "changes_requested" }));
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 3 }),
    });

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanRevision("run-1", { note: "Please simplify step 2" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "Please simplify step 2" },
    );
  });

  it("passes undefined opts to planReviserAgent.run when no note is given", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanRevision, planVersion: 2 });
    const { deps, artifactRepo, planReviserAgent } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan({ planVersion: 2 }));
    artifactRepo.seed("PlanReview", makePlanReview({ overallVerdict: "changes_requested" }));
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 3 }),
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
  it("throws when there is no Plan artifact", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const { deps } = buildFullDeps(run);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("sets approvedPlanVersion, transitions to Implementing, and posts a plain approval comment", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const { deps, runRepo, artifactRepo, linearClient } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan({ planVersion: 4 }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approvePlan("run-1");

    expect(runRepo.getCurrent().approvedPlanVersion).toBe(4);
    expect(result.state).toBe(RunState.Implementing);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v4 approved. Starting implementation...",
    );
  });

  it("includes the operator note in the approval comment when provided", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const { deps, artifactRepo, linearClient } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan({ planVersion: 4 }));

    const svc = new OrchestratorService(deps as never);
    await svc.approvePlan("run-1", { note: "Go ahead but watch the migration step" });

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Go ahead but watch the migration step"),
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("with operator note"),
    );
  });
});
