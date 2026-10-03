import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { buildDeps, makeRun, makeArtifact, makePlan } from "./_fixtures.js";

describe("OrchestratorService.runPlanReview", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow("No plan artifact found for run run-1");
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("changes_requested verdict: posts the review comment and chains into runPlanRevision", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.PlanReview });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() })) : Promise.resolve(null),
    );
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Test", description: "Test", branchName: "ai/lin-1", labels: [], priority: 0,
    });

    const planReview = {
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
    };
    planReviewerAgent.run.mockResolvedValue(planReview);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));

    const revisedRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision").mockResolvedValue(revisedRun);

    const result = await svc.runPlanReview("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Changes Requested"),
    );
    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBe(revisedRun);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, bumps planVersion, transitions PLAN_REVISED, and posts a comment", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.PlanRevision });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ planVersion: 1 });
    const planReview = { overallVerdict: "changes_requested", summary: "s", findings: [] };
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "PlanReview") return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: planReview }));
      return Promise.resolve(null);
    });
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Test", description: "Test", branchName: "ai/lin-1", labels: [], priority: 0,
    });

    const revisedPlan = makePlan({ planVersion: 2 });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "fair point" }] },
      revisedPlan,
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));

    const result = await svc.runPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(plan, planReview, expect.anything(), "run-1", undefined);
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Plan Revision Dispositions"),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("passes an operatorNote through to the plan reviser agent when provided", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Test", description: "Test", branchName: "ai/lin-1", labels: [], priority: 0,
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));

    await svc.runPlanRevision("run-1", { note: "focus on perf" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      expect.anything(),
      "run-1",
      { operatorNote: "focus on perf" },
    );
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("throws when there is no Plan artifact", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("sets approvedPlanVersion, transitions to Implementing, and posts a plain comment without a note", async () => {
    const { deps, runRepo, artifactRepo, linearClient, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    const plan = makePlan({ planVersion: 3 });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan })) : Promise.resolve(null),
    );
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 3 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 }));

    const result = await svc.approvePlan("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 3 });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      result.linearIssueId,
      "Plan v3 approved. Starting implementation...",
    );
    const eventTypes = eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain(RunEvent.PLAN_APPROVED);
    expect(result.state).toBe(RunState.Implementing);
  });

  it("includes the operator note in both the comment and the event payload", async () => {
    const { deps, runRepo, artifactRepo, linearClient, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan })) : Promise.resolve(null),
    );
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 1 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 }));

    const result = await svc.approvePlan("run-1", { note: "ship it" });

    expect(linearClient.postComment).toHaveBeenCalledWith(
      result.linearIssueId,
      expect.stringContaining("approved with operator note"),
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(result.linearIssueId, expect.stringContaining("ship it"));

    const approvalEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.PLAN_APPROVED,
    );
    expect((approvalEvent![0] as { payloadJson: { note?: string } }).payloadJson.note).toBe("ship it");
  });
});

describe("OrchestratorService.runManualReReview / runManualPlanRevision -- missing plan artifact", () => {
  it("runManualReReview throws when there is no Plan artifact", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("runManualPlanRevision throws when there is no Plan artifact", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });
});

describe("OrchestratorService.rejectPlan -- fresh mode and post-rejection blockers", () => {
  it("fresh mode: does not load prior plan/answers context into the planner call", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps({ answerResearcherAgent: undefined });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    runRepo.findById
      .mockResolvedValueOnce(run)
      .mockResolvedValue(makeRun({ state: RunState.PlanReview, planVersion: 3 }));
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Test", description: "Test", branchName: "ai/lin-1", labels: [], priority: 0,
    });
    const newPlan = makePlan({ planVersion: 3, openQuestions: [] });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: newPlan })) : Promise.resolve(null),
    );
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 3 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning })) // PLAN_REJECTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval })); // PLAN_REVIEW_APPROVED

    plannerAgent.run.mockResolvedValue(newPlan);
    (deps.planReviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue({
      overallVerdict: "approved", summary: "OK", findings: [],
    });

    await svc.rejectPlan("run-1", "start over", "api", "fresh");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({ previousPlan: expect.anything(), humanAnswers: expect.anything() }),
    );
  });

  it("pauses for clarification when the post-rejection re-plan still has blocking questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps({ answerResearcherAgent: undefined });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Test", description: "Test", branchName: "ai/lin-1", labels: [], priority: 0,
    });
    artifactRepo.findLatestByType.mockResolvedValue(null);
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning })) // PLAN_REJECTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded })); // NEEDS_HUMAN_CLARIFICATION

    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Which?", requiredForExecution: true }] }),
    );

    const result = await svc.rejectPlan("run-1", "try again", "api", "fresh");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect((deps.planReviewerAgent as { run: ReturnType<typeof vi.fn> }).run).not.toHaveBeenCalled();
  });
});
