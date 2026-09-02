import { describe, it, expect } from "vitest";
import { transition, getValidEvents } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine - BLOCKED transitions", () => {
  const blockable = [
    RunState.Todo,
    RunState.Planning,
    RunState.PlanReview,
    RunState.PlanRevision,
    RunState.AwaitingPlanApproval,
    RunState.Implementing,
    RunState.AIReview,
    RunState.AddressingReview,
  ];

  it.each(blockable)("%s + BLOCKED -> AIBlocked", (state) => {
    expect(transition(state, RunEvent.BLOCKED)).toBe(RunState.AIBlocked);
  });

  it("AIBlocked + RESET_TO_TODO -> Todo", () => {
    expect(transition(RunState.AIBlocked, RunEvent.RESET_TO_TODO)).toBe(RunState.Todo);
  });
});

describe("stateMachine - happy-path and review-cycle transitions not covered elsewhere", () => {
  it("Todo + RUN_REQUESTED -> Planning", () => {
    expect(transition(RunState.Todo, RunEvent.RUN_REQUESTED)).toBe(RunState.Planning);
  });

  it("Planning + PLAN_CREATED -> PlanReview", () => {
    expect(transition(RunState.Planning, RunEvent.PLAN_CREATED)).toBe(RunState.PlanReview);
  });

  it("PlanReview + PLAN_REVIEW_CHANGES_REQUESTED -> PlanRevision", () => {
    expect(transition(RunState.PlanReview, RunEvent.PLAN_REVIEW_CHANGES_REQUESTED)).toBe(
      RunState.PlanRevision,
    );
  });

  it("PlanRevision + PLAN_REVISED -> AwaitingPlanApproval", () => {
    expect(transition(RunState.PlanRevision, RunEvent.PLAN_REVISED)).toBe(
      RunState.AwaitingPlanApproval,
    );
  });

  it("AwaitingPlanApproval + PLAN_APPROVED -> Implementing", () => {
    expect(transition(RunState.AwaitingPlanApproval, RunEvent.PLAN_APPROVED)).toBe(
      RunState.Implementing,
    );
  });

  it("AwaitingPlanApproval + PLAN_REJECTED -> Planning", () => {
    expect(transition(RunState.AwaitingPlanApproval, RunEvent.PLAN_REJECTED)).toBe(
      RunState.Planning,
    );
  });

  it("AwaitingPlanApproval + RE_REVIEW_REQUESTED -> PlanReview", () => {
    expect(transition(RunState.AwaitingPlanApproval, RunEvent.RE_REVIEW_REQUESTED)).toBe(
      RunState.PlanReview,
    );
  });

  it("Implementing + EXECUTION_STARTED is a self-loop", () => {
    expect(transition(RunState.Implementing, RunEvent.EXECUTION_STARTED)).toBe(
      RunState.Implementing,
    );
  });

  it("Implementing + EXECUTION_FINISHED -> AIReview", () => {
    expect(transition(RunState.Implementing, RunEvent.EXECUTION_FINISHED)).toBe(RunState.AIReview);
  });

  it("AIReview + REVIEW_APPROVED -> ReadyForHumanReview", () => {
    expect(transition(RunState.AIReview, RunEvent.REVIEW_APPROVED)).toBe(
      RunState.ReadyForHumanReview,
    );
  });

  it("AIReview + REVIEW_CHANGES_REQUESTED -> AddressingReview", () => {
    expect(transition(RunState.AIReview, RunEvent.REVIEW_CHANGES_REQUESTED)).toBe(
      RunState.AddressingReview,
    );
  });

  it("AddressingReview + REMEDIATION_FINISHED -> AIReview", () => {
    expect(transition(RunState.AddressingReview, RunEvent.REMEDIATION_FINISHED)).toBe(
      RunState.AIReview,
    );
  });

  it("ReadyForHumanReview + HUMAN_APPROVED -> Done", () => {
    expect(transition(RunState.ReadyForHumanReview, RunEvent.HUMAN_APPROVED)).toBe(RunState.Done);
  });

  it("PlanReview + CLARIFICATION_EXHAUSTED -> Failed", () => {
    expect(transition(RunState.PlanReview, RunEvent.CLARIFICATION_EXHAUSTED)).toBe(
      RunState.Failed,
    );
  });

  it("Todo, Planning, PlanReview, AwaitingPlanApproval + NEEDS_HUMAN_CLARIFICATION -> HumanClarificationNeeded", () => {
    for (const state of [
      RunState.Todo,
      RunState.Planning,
      RunState.PlanReview,
      RunState.AwaitingPlanApproval,
    ]) {
      expect(transition(state, RunEvent.NEEDS_HUMAN_CLARIFICATION)).toBe(
        RunState.HumanClarificationNeeded,
      );
    }
  });
});

describe("stateMachine - invalid transitions", () => {
  it("throws StateTransitionError for a state with no transition table entry at all", () => {
    expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(StateTransitionError);
    expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(
      'No transition from state "Done" for event "RUN_REQUESTED"',
    );
  });

  it("throws StateTransitionError for a known state but an event it doesn't accept", () => {
    expect(() => transition(RunState.Todo, RunEvent.PLAN_APPROVED)).toThrow(StateTransitionError);
    expect(() => transition(RunState.Todo, RunEvent.PLAN_APPROVED)).toThrow(
      'No transition from state "Todo" for event "PLAN_APPROVED"',
    );
  });

  it("getValidEvents returns an empty array for a state with no outgoing transitions", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });
});
