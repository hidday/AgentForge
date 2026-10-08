import { describe, it, expect } from "vitest";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import {
  createHarness,
  makePlan,
  makePlanReview,
  makeRun,
  makeSkill,
  type HarnessOptions,
} from "./helpers/orchestratorHarness.js";

const changesRequested: PlanReview = makePlanReview({
  reviewId: "pr-cr",
  summary: "Missing rollback",
  overallVerdict: "changes_requested",
  findings: [
    {
      id: "pf1",
      severity: "important",
      type: "gap",
      title: "Rollback",
      details: "Add a rollback step",
    },
  ],
});

function awaitingHarness(overrides: Partial<HarnessOptions> = {}) {
  return createHarness({
    run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }),
    artifacts: [{ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// runManualReReview
// ---------------------------------------------------------------------------
describe("OrchestratorService.runManualReReview", () => {
  it("re-reviews the plan and returns to AwaitingPlanApproval on approval", async () => {
    const h = awaitingHarness();

    const run = await h.svc.runManualReReview("run-1");

    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.recordedEventTypes()).toEqual([
      RunEvent.RE_REVIEW_REQUESTED,
      RunEvent.PLAN_REVIEW_APPROVED,
    ]);
    expect(h.recordedEvent(RunEvent.RE_REVIEW_REQUESTED)).toMatchObject({
      source: "human",
      payloadJson: {
        from: RunState.AwaitingPlanApproval,
        to: RunState.PlanReview,
        trigger: "re-review",
      },
    });
    expect(h.planReviewerAgent.run.mock.calls[0]?.[3]).toBeUndefined();
  });

  it("returns to AwaitingPlanApproval without auto-revising when changes are requested", async () => {
    const h = awaitingHarness({ config: { planReviews: [changesRequested] } });

    const run = await h.svc.runManualReReview("run-1", { note: "focus on rollback" });

    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.planReviserAgent.run).not.toHaveBeenCalled();
    expect(h.recordedEventTypes()).not.toContain(RunEvent.PLAN_REVIEW_CHANGES_REQUESTED);
    expect(h.recordedEvent(RunEvent.RE_REVIEW_REQUESTED)?.payloadJson).toMatchObject({
      trigger: "re-review",
      note: "focus on rollback",
    });
    expect(h.planReviewerAgent.run.mock.calls[0]?.[3]).toEqual({
      operatorNote: "focus on rollback",
    });
    // The new PlanReview artifact is persisted for the human to read.
    expect(h.artifactsOfType("PlanReview").at(-1)?.payloadJson).toEqual(changesRequested);
  });

  it("fails when there is no plan to review", async () => {
    const h = awaitingHarness({ artifacts: [] });

    await expect(h.svc.runManualReReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("is rejected from states other than AwaitingPlanApproval", async () => {
    const h = awaitingHarness({ run: makeRun({ state: RunState.Implementing }) });

    await expect(h.svc.runManualReReview("run-1")).rejects.toBeInstanceOf(StateTransitionError);
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
    expect(h.eventRepo.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runManualPlanRevision
// ---------------------------------------------------------------------------
describe("OrchestratorService.runManualPlanRevision", () => {
  it("stops after review when the reviewer approves (no revision needed)", async () => {
    const h = awaitingHarness();

    const run = await h.svc.runManualPlanRevision("run-1");

    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.planReviserAgent.run).not.toHaveBeenCalled();
    expect(h.recordedEvent(RunEvent.RE_REVIEW_REQUESTED)?.payloadJson).toMatchObject({
      trigger: "revise",
    });
    expect(h.recordedEventTypes()).toEqual([
      RunEvent.RE_REVIEW_REQUESTED,
      RunEvent.PLAN_REVIEW_APPROVED,
    ]);
  });

  it("revises the plan with the operator note when changes are requested", async () => {
    const h = awaitingHarness({
      config: {
        planReviews: [changesRequested],
        dispositions: [{ findingId: "pf1", status: "accepted", rationale: "Added rollback" }],
      },
    });

    const run = await h.svc.runManualPlanRevision("run-1", { note: "keep scope tight" });

    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    expect(run.planVersion).toBe(3);
    expect(h.recordedEventTypes()).toEqual([
      RunEvent.RE_REVIEW_REQUESTED,
      RunEvent.PLAN_REVIEW_CHANGES_REQUESTED,
      RunEvent.PLAN_REVISED,
    ]);
    expect(h.recordedEvent(RunEvent.RE_REVIEW_REQUESTED)?.payloadJson).toMatchObject({
      trigger: "revise",
      note: "keep scope tight",
    });
    expect(h.planReviewerAgent.run.mock.calls[0]?.[3]).toEqual({
      operatorNote: "keep scope tight",
    });
    expect(h.planReviserAgent.run).toHaveBeenCalledWith(
      makePlan({ planVersion: 2 }),
      changesRequested,
      expect.anything(),
      "run-1",
      { operatorNote: "keep scope tight" },
    );
    const comment = h.comments().at(-1) ?? "";
    expect(comment).toContain("## AI Plan (v3)");
    expect(comment).toContain("- **pf1** [accepted]: Added rollback");
  });

  it("passes no operator options to the reviser when no note is given", async () => {
    const h = awaitingHarness({ config: { planReviews: [changesRequested] } });

    await h.svc.runManualPlanRevision("run-1");

    expect(h.planReviewerAgent.run.mock.calls[0]?.[3]).toBeUndefined();
    expect(h.planReviserAgent.run.mock.calls[0]?.[4]).toBeUndefined();
  });

  it("fails when there is no plan to revise", async () => {
    const h = awaitingHarness({ artifacts: [] });

    await expect(h.svc.runManualPlanRevision("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
    expect(h.planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("is rejected for an unknown run", async () => {
    const h = createHarness({ run: null });
    await expect(h.svc.runManualPlanRevision("nope")).rejects.toThrow("Run not found: nope");
  });
});

// ---------------------------------------------------------------------------
// approveHumanReview (+ terminal-state worktree cleanup and skill metrics)
// ---------------------------------------------------------------------------
describe("OrchestratorService.approveHumanReview", () => {
  function readyHarness(overrides: Partial<HarnessOptions> = {}) {
    return createHarness({
      run: makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42 }),
      withDistillation: true,
      ...overrides,
    });
  }

  it("distils, moves to Done, posts a comment and removes the worktree", async () => {
    const h = readyHarness();
    const order: string[] = [];
    h.distillationAgent.run.mockImplementation(async () => {
      order.push("distill");
    });
    h.gitService.removeWorktree.mockImplementation(async () => {
      order.push("removeWorktree");
    });

    const run = await h.svc.approveHumanReview("run-1");

    expect(run.state).toBe(RunState.Done);
    expect(h.distillationAgent.run).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ id: "run-1", state: RunState.ReadyForHumanReview }),
    );
    // Distillation must run while the worktree still exists.
    expect(order).toEqual(["distill", "removeWorktree"]);
    expect(h.gitService.removeWorktree).toHaveBeenCalledWith(
      "/repos/test-repo",
      "/repos/test-repo/.worktrees/run-1",
    );
    expect(h.recordedEvent(RunEvent.HUMAN_APPROVED)).toMatchObject({
      source: "human",
      payloadJson: { from: RunState.ReadyForHumanReview, to: RunState.Done },
    });
    expect(h.comments()).toEqual(["Human review approved. Run is **Done**."]);
  });

  it("treats distillation failures as best-effort", async () => {
    const h = readyHarness();
    h.distillationAgent.run.mockRejectedValue(new Error("distill exploded"));

    const run = await h.svc.approveHumanReview("run-1");

    expect(run.state).toBe(RunState.Done);
    expect(h.logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "distill exploded" },
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("stringifies non-Error distillation failures", async () => {
    const h = readyHarness();
    h.distillationAgent.run.mockRejectedValue("plain string failure");

    await h.svc.approveHumanReview("run-1");

    expect(h.logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "plain string failure" },
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("works without a distillation agent and skips cleanup when not in a worktree", async () => {
    const h = readyHarness({
      withDistillation: false,
      run: makeRun({
        state: RunState.ReadyForHumanReview,
        workingDirectory: "/repos/test-repo",
      }),
    });

    const run = await h.svc.approveHumanReview("run-1");

    expect(run.state).toBe(RunState.Done);
    expect(h.distillationAgent.run).not.toHaveBeenCalled();
    expect(h.gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("is rejected when the run is not ready for human review", async () => {
    const h = readyHarness({ run: makeRun({ state: RunState.AIReview }) });

    await expect(h.svc.approveHumanReview("run-1")).rejects.toBeInstanceOf(StateTransitionError);
    expect(h.store.run?.state).toBe(RunState.AIReview);
    expect(h.gitService.removeWorktree).not.toHaveBeenCalled();
    expect(h.linearClient.postComment).not.toHaveBeenCalled();
  });

  it("credits each injected skill once on success and archives low-utility ones", async () => {
    const h = readyHarness({
      withSkillRepo: true,
      events: [
        { eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["sk-1", "sk-2"] } },
        { eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["sk-2", "sk-3"] } },
        { eventType: "SKILL_INJECTION", payloadJson: {} },
      ],
    });

    await h.svc.approveHumanReview("run-1");

    expect(h.agentSkillRepo.incrementSuccess.mock.calls.map((c) => c[0])).toEqual([
      "sk-1",
      "sk-2",
      "sk-3",
    ]);
    expect(h.agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(h.agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(3);
    expect(h.agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith({
      id: "sk-2",
      outcome: "success",
    });
  });

  it("keeps updating remaining skills when one metric update fails", async () => {
    const h = readyHarness({
      withSkillRepo: true,
      events: [{ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["sk-1", "sk-2"] } }],
    });
    h.agentSkillRepo.incrementSuccess.mockImplementation(async (id: string) => {
      if (id === "sk-1") throw new Error("row locked");
      return { id, outcome: "success" };
    });

    const run = await h.svc.approveHumanReview("run-1");

    expect(run.state).toBe(RunState.Done);
    expect(h.agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(1);
    expect(h.agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith({
      id: "sk-2",
      outcome: "success",
    });
    expect(h.logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", skillId: "sk-1", error: "row locked" },
      "Failed to update skill metric",
    );
  });

  it("stringifies non-Error skill metric failures", async () => {
    const h = readyHarness({
      withSkillRepo: true,
      events: [{ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["sk-1"] } }],
    });
    h.agentSkillRepo.archiveIfLowUtility.mockRejectedValue(42);

    await h.svc.approveHumanReview("run-1");

    expect(h.logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", skillId: "sk-1", error: "42" },
      "Failed to update skill metric",
    );
  });

  it("does not touch skill metrics when no skills were injected", async () => {
    const h = readyHarness({ withSkillRepo: true });

    await h.svc.approveHumanReview("run-1");

    expect(h.eventRepo.findByRunId).toHaveBeenCalledWith("run-1");
    expect(h.agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(h.agentSkillRepo.archiveIfLowUtility).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService terminal Failed state (clarification exhausted)", () => {
  it("cleans up the worktree and records skill failures when the run fails", async () => {
    const blocking = [{ id: "q1", question: "Which region?", requiredForExecution: true }];
    const h = createHarness({
      run: makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 3 }),
      withSkillRepo: true,
      skills: [makeSkill("sk-9")],
      events: [
        { eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["sk-9"] } },
        { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION },
        { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION },
        { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION },
      ],
      artifacts: [
        { type: "Plan", version: 3, payloadJson: makePlan({ planVersion: 3, openQuestions: blocking }) },
        { type: "TaskBundle", version: 1, payloadJson: { issue: { id: "LIN-1" } } },
      ],
      config: { plannerOutputs: [{ openQuestions: blocking }] },
    });

    const run = await h.svc.answerQuestions("run-1", [{ questionId: "q1", answer: "unsure" }]);

    expect(run.state).toBe(RunState.Failed);
    expect(h.gitService.removeWorktree).toHaveBeenCalledWith(
      "/repos/test-repo",
      "/repos/test-repo/.worktrees/run-1",
    );
    expect(h.agentSkillRepo.incrementFailure).toHaveBeenCalledWith("sk-9");
    expect(h.agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(h.agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith({
      id: "sk-9",
      outcome: "failure",
    });
  });
});
