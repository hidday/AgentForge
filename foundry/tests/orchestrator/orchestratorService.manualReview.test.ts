import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import { buildDeps, makeStore, pushArtifact, type Store } from "./helpers/fixtures.js";

function makePlan(): Plan {
  return {
    planVersion: 2,
    summary: "Test plan",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
  };
}

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "pr-1",
    summary: "Looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function setupAwaitingApprovalRun(store: Store) {
  store.run = { ...store.run, state: RunState.AwaitingPlanApproval, planVersion: 2 };
  pushArtifact(store, "Plan", 2, makePlan());
}

describe("OrchestratorService.runManualReReview", () => {
  it("transitions RE_REVIEW_REQUESTED then PLAN_REVIEW_APPROVED when the reviewer approves", async () => {
    const store = makeStore();
    setupAwaitingApprovalRun(store);
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    built.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const result = await svc.runManualReReview("run-1");

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toEqual([RunEvent.RE_REVIEW_REQUESTED, RunEvent.PLAN_REVIEW_APPROVED]);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("ALSO returns to AwaitingPlanApproval (not PlanRevision) when the reviewer requests changes -- current behavior, human retains control", async () => {
    const store = makeStore();
    setupAwaitingApprovalRun(store);
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    built.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({ overallVerdict: "changes_requested" }),
    );

    const result = await svc.runManualReReview("run-1");

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    // Both verdict branches record the same PLAN_REVIEW_APPROVED transition,
    // per the "always return to AwaitingPlanApproval" design of this method.
    expect(eventTypes).toEqual([RunEvent.RE_REVIEW_REQUESTED, RunEvent.PLAN_REVIEW_APPROVED]);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("passes opts.note through as trigger metadata and operatorNote to the plan reviewer", async () => {
    const store = makeStore();
    setupAwaitingApprovalRun(store);
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    built.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    await svc.runManualReReview("run-1", { note: "double check the auth flow" });

    expect(built.planReviewerAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ planVersion: 2 }),
      expect.anything(),
      "run-1",
      { operatorNote: "double check the auth flow" },
    );
    const firstEventCall = built.eventRepo.create.mock.calls[0]![0] as {
      payloadJson: Record<string, unknown>;
    };
    expect(firstEventCall.payloadJson).toMatchObject({
      trigger: "re-review",
      note: "double check the auth flow",
    });
  });

  it("throws when there is no plan artifact for the run", async () => {
    const store = makeStore();
    store.run = { ...store.run, state: RunState.AwaitingPlanApproval };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow("No plan artifact found");
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("transitions RE_REVIEW_REQUESTED then PLAN_REVIEW_APPROVED and does NOT trigger a revision when approved", async () => {
    const store = makeStore();
    setupAwaitingApprovalRun(store);
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    built.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision");

    const result = await svc.runManualPlanRevision("run-1");

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toEqual([RunEvent.RE_REVIEW_REQUESTED, RunEvent.PLAN_REVIEW_APPROVED]);
    expect(runPlanRevisionSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("transitions to PlanRevision and delegates to runPlanRevision (with the note) when changes are requested", async () => {
    const store = makeStore();
    setupAwaitingApprovalRun(store);
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    built.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({ overallVerdict: "changes_requested" }),
    );
    const revisedRun = { ...store.run, state: RunState.AwaitingPlanApproval, planVersion: 3 };
    const runPlanRevisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(revisedRun as never);

    const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toEqual([RunEvent.RE_REVIEW_REQUESTED, RunEvent.PLAN_REVIEW_CHANGES_REQUESTED]);
    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1", { note: "tighten scope" });
    expect(result).toBe(revisedRun);
  });

  it("calls runPlanRevision with undefined opts when no note is provided on the changes_requested path", async () => {
    const store = makeStore();
    setupAwaitingApprovalRun(store);
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    built.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({ overallVerdict: "changes_requested" }),
    );
    const runPlanRevisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(store.run as never);

    await svc.runManualPlanRevision("run-1");

    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1", undefined);
  });

  it("throws when there is no plan artifact for the run", async () => {
    const store = makeStore();
    store.run = { ...store.run, state: RunState.AwaitingPlanApproval };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow("No plan artifact found");
  });
});
