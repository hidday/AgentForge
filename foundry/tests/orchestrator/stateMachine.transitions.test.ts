import { describe, it, expect } from "vitest";
import { transition, getValidEvents } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine - full transition table", () => {
  const validTransitions: [RunState, RunEvent, RunState][] = [
    [RunState.Todo, RunEvent.RUN_REQUESTED, RunState.Planning],
    [RunState.Planning, RunEvent.PLAN_CREATED, RunState.PlanReview],
    [RunState.PlanReview, RunEvent.PLAN_REVIEW_APPROVED, RunState.AwaitingPlanApproval],
    [RunState.PlanReview, RunEvent.PLAN_REVIEW_CHANGES_REQUESTED, RunState.PlanRevision],
    [RunState.PlanRevision, RunEvent.PLAN_REVISED, RunState.AwaitingPlanApproval],
    [RunState.AwaitingPlanApproval, RunEvent.PLAN_APPROVED, RunState.Implementing],
    [RunState.AwaitingPlanApproval, RunEvent.PLAN_REJECTED, RunState.Planning],
    [RunState.AwaitingPlanApproval, RunEvent.RE_REVIEW_REQUESTED, RunState.PlanReview],
    [RunState.Implementing, RunEvent.EXECUTION_STARTED, RunState.Implementing],
    [RunState.Implementing, RunEvent.EXECUTION_FINISHED, RunState.AIReview],
    [RunState.AIReview, RunEvent.REVIEW_APPROVED, RunState.ReadyForHumanReview],
    [RunState.AIReview, RunEvent.REVIEW_CHANGES_REQUESTED, RunState.AddressingReview],
    [RunState.AddressingReview, RunEvent.REMEDIATION_FINISHED, RunState.AIReview],
    [RunState.ReadyForHumanReview, RunEvent.HUMAN_APPROVED, RunState.Done],
    [RunState.AIBlocked, RunEvent.RESET_TO_TODO, RunState.Todo],
    [RunState.PlanReview, RunEvent.CLARIFICATION_EXHAUSTED, RunState.Failed],
    [
      RunState.AwaitingPlanApproval,
      RunEvent.NEEDS_HUMAN_CLARIFICATION,
      RunState.HumanClarificationNeeded,
    ],
  ];

  it.each(validTransitions)("%s + %s -> %s", (from, event, to) => {
    expect(transition(from, event)).toBe(to);
  });

  it.each([
    RunState.Todo,
    RunState.Planning,
    RunState.PlanReview,
    RunState.PlanRevision,
    RunState.AwaitingPlanApproval,
    RunState.Implementing,
    RunState.AIReview,
    RunState.AddressingReview,
  ])("active state %s can be BLOCKED", (from) => {
    expect(transition(from, RunEvent.BLOCKED)).toBe(RunState.AIBlocked);
  });

  it("terminal/non-blockable states cannot be BLOCKED", () => {
    for (const s of [RunState.ReadyForHumanReview, RunState.AIBlocked, RunState.Failed]) {
      expect(() => transition(s, RunEvent.BLOCKED)).toThrow(StateTransitionError);
    }
  });
});

describe("stateMachine - invalid transitions", () => {
  it("throws StateTransitionError for a state with no outgoing transitions at all (Done)", () => {
    let caught: unknown;
    try {
      transition(RunState.Done, RunEvent.RESET_TO_TODO);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StateTransitionError);
    const e = caught as StateTransitionError;
    expect(e.fromState).toBe(RunState.Done);
    expect(e.event).toBe(RunEvent.RESET_TO_TODO);
    expect(e.message).toBe('No transition from state "Done" for event "RESET_TO_TODO"');
  });

  it("throws StateTransitionError when the state exists but the event is not allowed", () => {
    let caught: unknown;
    try {
      transition(RunState.Todo, RunEvent.PLAN_APPROVED);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StateTransitionError);
    expect((caught as StateTransitionError).fromState).toBe(RunState.Todo);
    expect((caught as StateTransitionError).event).toBe(RunEvent.PLAN_APPROVED);
  });

  it("cannot skip plan approval: Planning cannot jump straight to Implementing", () => {
    expect(() => transition(RunState.Planning, RunEvent.PLAN_APPROVED)).toThrow(
      StateTransitionError,
    );
  });

  it("HUMAN_REQUESTED is not wired into the transition table for any state", () => {
    for (const s of Object.values(RunState)) {
      expect(() => transition(s, RunEvent.HUMAN_REQUESTED)).toThrow(StateTransitionError);
    }
  });
});

describe("stateMachine - getValidEvents", () => {
  it("returns an empty list for Done (no outgoing transitions)", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });

  it("returns exactly the allowed events for AwaitingPlanApproval", () => {
    expect(new Set(getValidEvents(RunState.AwaitingPlanApproval))).toEqual(
      new Set([
        RunEvent.PLAN_APPROVED,
        RunEvent.PLAN_REJECTED,
        RunEvent.RE_REVIEW_REQUESTED,
        RunEvent.BLOCKED,
        RunEvent.NEEDS_HUMAN_CLARIFICATION,
      ]),
    );
  });

  it("every event returned by getValidEvents is accepted by transition()", () => {
    for (const s of Object.values(RunState)) {
      for (const e of getValidEvents(s)) {
        expect(() => transition(s, e)).not.toThrow();
      }
    }
  });
});
