import { describe, it, expect } from "vitest";
import { transition, getValidEvents } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

// Targets the two throw sites in transition() that stateMachine.test.ts does
// not exercise: a `currentState` with no entries at all in the transition
// table, and a `currentState` that IS in the table but does not accept the
// given event.
describe("stateMachine - transition() error paths", () => {
  it("throws StateTransitionError when currentState has no outgoing transitions at all", () => {
    // RunState.Done is a terminal state: it is never used as a "from" state
    // when building the transition table, so the table has no entry for it.
    expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(StateTransitionError);

    try {
      transition(RunState.Done, RunEvent.RUN_REQUESTED);
      expect.fail("expected transition() to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      const e = err as StateTransitionError;
      expect(e.fromState).toBe(RunState.Done);
      expect(e.event).toBe(RunEvent.RUN_REQUESTED);
      expect(e.message).toBe('No transition from state "Done" for event "RUN_REQUESTED"');
    }
  });

  it("throws StateTransitionError when currentState exists in the table but the event is not valid for it", () => {
    // RunState.Todo accepts RUN_REQUESTED, BLOCKED and NEEDS_HUMAN_CLARIFICATION,
    // but not PLAN_CREATED.
    expect(() => transition(RunState.Todo, RunEvent.PLAN_CREATED)).toThrow(StateTransitionError);

    try {
      transition(RunState.Todo, RunEvent.PLAN_CREATED);
      expect.fail("expected transition() to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      const e = err as StateTransitionError;
      expect(e.fromState).toBe(RunState.Todo);
      expect(e.event).toBe(RunEvent.PLAN_CREATED);
      expect(e.message).toBe('No transition from state "Todo" for event "PLAN_CREATED"');
    }
  });

  it("getValidEvents returns an empty array for a state with no outgoing transitions", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });
});
