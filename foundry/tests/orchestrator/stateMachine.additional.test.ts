import { describe, it, expect } from "vitest";
import { transition, getValidEvents } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine - invalid transitions", () => {
  it("throws StateTransitionError when the current state has no entries in the transition table", () => {
    // RunState.Done and RunState.ReadyForHumanReview (besides HUMAN_APPROVED) have
    // no outgoing entries other than what's registered; Done has none at all.
    expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(StateTransitionError);

    let caught: unknown;
    try {
      transition(RunState.Done, RunEvent.RUN_REQUESTED);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StateTransitionError);
    expect((caught as StateTransitionError).fromState).toBe(RunState.Done);
    expect((caught as StateTransitionError).event).toBe(RunEvent.RUN_REQUESTED);
    expect((caught as Error).message).toBe(
      'No transition from state "Done" for event "RUN_REQUESTED"',
    );
  });

  it("throws StateTransitionError when the state exists but the event is not registered for it", () => {
    // RunState.Todo has entries for RUN_REQUESTED/BLOCKED/NEEDS_HUMAN_CLARIFICATION,
    // but not for PLAN_APPROVED.
    expect(() => transition(RunState.Todo, RunEvent.PLAN_APPROVED)).toThrow(StateTransitionError);

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

  it("getValidEvents returns an empty array for a state with no transition table entry", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });

  it("getValidEvents returns the registered events for a state that has entries", () => {
    const events = getValidEvents(RunState.Todo);
    expect(events).toContain(RunEvent.RUN_REQUESTED);
    expect(events).toContain(RunEvent.BLOCKED);
    expect(events).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
  });
});
