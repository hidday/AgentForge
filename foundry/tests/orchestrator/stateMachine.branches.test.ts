import { describe, it, expect } from "vitest";
import { transition, getValidEvents } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine.transition -- invalid transitions", () => {
  it("throws StateTransitionError for a state with no outgoing transitions at all (Done)", () => {
    let caught: StateTransitionError | undefined;
    try {
      transition(RunState.Done, RunEvent.RUN_REQUESTED);
    } catch (err) {
      caught = err as StateTransitionError;
    }
    expect(caught).toBeInstanceOf(StateTransitionError);
    expect(caught?.fromState).toBe(RunState.Done);
    expect(caught?.event).toBe(RunEvent.RUN_REQUESTED);
  });

  it("throws StateTransitionError for a valid state but an event not defined for it", () => {
    let caught: StateTransitionError | undefined;
    try {
      transition(RunState.Todo, RunEvent.PLAN_APPROVED);
    } catch (err) {
      caught = err as StateTransitionError;
    }
    expect(caught).toBeInstanceOf(StateTransitionError);
    expect(caught?.fromState).toBe(RunState.Todo);
    expect(caught?.event).toBe(RunEvent.PLAN_APPROVED);
  });

  it("includes both the state and event in the error message", () => {
    expect(() => transition(RunState.ReadyForHumanReview, RunEvent.RUN_REQUESTED)).toThrow(
      /ReadyForHumanReview.*RUN_REQUESTED/,
    );
  });
});

describe("stateMachine.getValidEvents -- edge cases", () => {
  it("returns an empty array for a terminal state with no outgoing transitions (Done)", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });

  it("returns exactly [HUMAN_APPROVED] for ReadyForHumanReview", () => {
    const events = getValidEvents(RunState.ReadyForHumanReview);
    expect(events).toHaveLength(1);
    expect(events).toContain(RunEvent.HUMAN_APPROVED);
  });
});

describe("stateMachine.transition -- full happy-path lane", () => {
  it("Todo + RUN_REQUESTED -> Planning", () => {
    expect(transition(RunState.Todo, RunEvent.RUN_REQUESTED)).toBe(RunState.Planning);
  });

  it("Planning + PLAN_CREATED -> PlanReview", () => {
    expect(transition(RunState.Planning, RunEvent.PLAN_CREATED)).toBe(RunState.PlanReview);
  });

  it("PlanReview + PLAN_REVIEW_APPROVED -> AwaitingPlanApproval", () => {
    expect(transition(RunState.PlanReview, RunEvent.PLAN_REVIEW_APPROVED)).toBe(
      RunState.AwaitingPlanApproval,
    );
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

  it("Implementing + EXECUTION_STARTED -> Implementing (self-loop)", () => {
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
});

describe("stateMachine.transition -- BLOCKED from every eligible active state", () => {
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

  it("ReadyForHumanReview has no BLOCKED transition defined", () => {
    expect(() => transition(RunState.ReadyForHumanReview, RunEvent.BLOCKED)).toThrow(
      StateTransitionError,
    );
  });
});

describe("stateMachine.transition -- NEEDS_HUMAN_CLARIFICATION from every eligible state", () => {
  const clarifiable = [
    RunState.Todo,
    RunState.Planning,
    RunState.PlanReview,
    RunState.AwaitingPlanApproval,
  ];

  it.each(clarifiable)("%s + NEEDS_HUMAN_CLARIFICATION -> HumanClarificationNeeded", (state) => {
    expect(transition(state, RunEvent.NEEDS_HUMAN_CLARIFICATION)).toBe(
      RunState.HumanClarificationNeeded,
    );
  });

  it("Implementing has no NEEDS_HUMAN_CLARIFICATION transition defined", () => {
    expect(() => transition(RunState.Implementing, RunEvent.NEEDS_HUMAN_CLARIFICATION)).toThrow(
      StateTransitionError,
    );
  });
});

describe("stateMachine.transition -- recovery via RESET_TO_TODO", () => {
  it("AIBlocked + RESET_TO_TODO -> Todo", () => {
    expect(transition(RunState.AIBlocked, RunEvent.RESET_TO_TODO)).toBe(RunState.Todo);
  });

  it("Planning has no RESET_TO_TODO transition defined (not a recoverable terminal state)", () => {
    expect(() => transition(RunState.Planning, RunEvent.RESET_TO_TODO)).toThrow(
      StateTransitionError,
    );
  });
});

describe("stateMachine.transition -- CLARIFICATION_EXHAUSTED", () => {
  it("PlanReview + CLARIFICATION_EXHAUSTED -> Failed", () => {
    expect(transition(RunState.PlanReview, RunEvent.CLARIFICATION_EXHAUSTED)).toBe(
      RunState.Failed,
    );
  });

  it("AwaitingPlanApproval has no CLARIFICATION_EXHAUSTED transition defined", () => {
    expect(() =>
      transition(RunState.AwaitingPlanApproval, RunEvent.CLARIFICATION_EXHAUSTED),
    ).toThrow(StateTransitionError);
  });
});

describe("stateMachine.getValidEvents -- sanity checks against transition table", () => {
  it("every event returned by getValidEvents actually transitions successfully for that state", () => {
    const allStates = Object.values(RunState);
    for (const state of allStates) {
      for (const event of getValidEvents(state)) {
        expect(() => transition(state, event)).not.toThrow();
      }
    }
  });

  it("AwaitingPlanApproval exposes exactly PLAN_APPROVED, PLAN_REJECTED, RE_REVIEW_REQUESTED, and NEEDS_HUMAN_CLARIFICATION", () => {
    const events = getValidEvents(RunState.AwaitingPlanApproval);
    expect(new Set(events)).toEqual(
      new Set([
        RunEvent.PLAN_APPROVED,
        RunEvent.PLAN_REJECTED,
        RunEvent.RE_REVIEW_REQUESTED,
        RunEvent.NEEDS_HUMAN_CLARIFICATION,
        RunEvent.BLOCKED,
      ]),
    );
  });
});
