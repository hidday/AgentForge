import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { buildDeps, makeRun, makePlan, makeArtifact } from "./testHelpers.js";

describe("OrchestratorService.rejectPlan -- re-plan still has blocking questions", () => {
  it("pauses for human clarification instead of proceeding to plan review", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const built = buildDeps({ run });
    built.setPlannerPlan(
      makePlan({
        planVersion: 3,
        openQuestions: [{ id: "q1", question: "Which region?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.rejectPlan("run-1", "please reconsider region handling", "api");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const events = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(events).toContain(RunEvent.PLAN_CREATED);
    expect(events).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
  });

  it("in fresh mode, does not load prior plan/answers context before re-planning", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const built = buildDeps({
      run,
      artifacts: {
        Plan: makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 2 }) }),
        HumanAnswers: makeArtifact({
          type: "HumanAnswers",
          payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
        }),
      },
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.rejectPlan("run-1", "start over", "api", "fresh");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({ humanAnswers: expect.anything() }),
    );
  });
});

describe("OrchestratorService.answerQuestions -- HumanClarificationNeeded re-plan branches", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const run = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded });
    const { deps } = buildDeps({ run, artifacts: { Plan: null } });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.answerQuestions("run-1", [])).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("throws when no TaskBundle artifact exists for the run (re-plan path)", async () => {
    const run = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Scope?", requiredForExecution: true }],
    });
    const { deps } = buildDeps({
      run,
      artifacts: {
        Plan: makeArtifact({ type: "Plan", payloadJson: plan }),
        TaskBundle: null,
      },
    });
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow("No TaskBundle artifact found for run run-1");
  });

  it("loops back to HumanClarificationNeeded (incrementing iteration) when blockers remain and max iterations not reached", async () => {
    const run = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Scope?", requiredForExecution: true }],
    });
    const built = buildDeps({
      run,
      artifacts: {
        Plan: makeArtifact({ type: "Plan", payloadJson: plan }),
        TaskBundle: makeArtifact({ type: "TaskBundle", payloadJson: {} }),
      },
    });
    // Still-blocking re-plan.
    built.setPlannerPlan(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q2", question: "Still unclear?", requiredForExecution: true }],
      }),
    );
    // Only one prior NEEDS_HUMAN_CLARIFICATION event recorded so far (below MAX_CLARIFICATION_ITERATIONS=3).
    built.eventRepo.findByRunId.mockResolvedValue([
      {
        id: "evt-1",
        runId: "run-1",
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      },
    ]);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const lastCall = built.eventRepo.create.mock.calls.at(-1)![0] as {
      eventType: string;
      payloadJson: { iteration: number; blockingQuestions: unknown[] };
    };
    expect(lastCall.eventType).toBe(RunEvent.NEEDS_HUMAN_CLARIFICATION);
    expect(lastCall.payloadJson.iteration).toBe(2);
    expect(lastCall.payloadJson.blockingQuestions).toEqual([
      { id: "q2", question: "Still unclear?" },
    ]);
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("always returns to AwaitingPlanApproval when the reviewer approves", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("returns to AwaitingPlanApproval (not auto-chaining into revision) when the reviewer requests changes", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
    });
    built.setPlanReviewResult({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [{ id: "f1", severity: "important", title: "Issue", details: "detail" }],
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("throws when no Plan artifact exists for the run", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const { deps } = buildDeps({ run, artifacts: { Plan: null } });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("forwards the operator note to the plan reviewer agent", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runManualReReview("run-1", { note: "double check auth" });

    expect(built.planReviewerAgent.run).toHaveBeenCalledWith(plan, expect.anything(), "run-1", {
      operatorNote: "double check auth",
    });
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const { deps } = buildDeps({ run, artifacts: { Plan: null } });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("stays at AwaitingPlanApproval with no revision when the reviewer approves", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("runs plan revision and ends at AwaitingPlanApproval when the reviewer requests changes", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
    });
    built.setPlanReviewResult({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [{ id: "f1", severity: "important", title: "Issue", details: "detail" }],
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(built.planReviserAgent.run).toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("transitions to Done and posts the completion comment", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const { deps, linearClient } = buildDeps({ run });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Done"),
    );
  });

  it("invokes the distillation agent (best-effort) before transitioning when configured", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const built = buildDeps({ run, withDistillationAgent: true });

    const svc = new OrchestratorService(built.deps as never);
    await svc.approveHumanReview("run-1");

    expect(built.distillationAgent!.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
  });

  it("swallows a distillation agent failure and still completes the run", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const built = buildDeps({ run, withDistillationAgent: true });
    built.distillationAgent!.run.mockRejectedValue(new Error("distillation boom"));

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation boom" }),
      expect.stringContaining("Distillation agent failed"),
    );
  });
});
