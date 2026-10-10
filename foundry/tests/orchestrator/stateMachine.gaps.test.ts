import { describe, it, expect } from "vitest";
import { transition, getValidEvents } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine - error branches", () => {
  it("throws StateTransitionError when the current state has no entries in the transition table at all", () => {
    // RunState.Done is a terminal state that is never used as a `from` state
    // in the transition table, so looking it up finds no stateMap.
    expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(StateTransitionError);
    try {
      transition(RunState.Done, RunEvent.RUN_REQUESTED);
      expect.unreachable("transition should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      const e = err as StateTransitionError;
      expect(e.fromState).toBe(RunState.Done);
      expect(e.event).toBe(RunEvent.RUN_REQUESTED);
      expect(e.message).toBe(
        `No transition from state "${RunState.Done}" for event "${RunEvent.RUN_REQUESTED}"`,
      );
    }
  });

  it("throws StateTransitionError when the state exists but has no transition for the given event", () => {
    // RunState.Todo has entries in the table (e.g. RUN_REQUESTED), but not for
    // PLAN_CREATED, so the stateMap lookup succeeds while the event lookup fails.
    expect(() => transition(RunState.Todo, RunEvent.PLAN_CREATED)).toThrow(StateTransitionError);
    try {
      transition(RunState.Todo, RunEvent.PLAN_CREATED);
      expect.unreachable("transition should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      const e = err as StateTransitionError;
      expect(e.fromState).toBe(RunState.Todo);
      expect(e.event).toBe(RunEvent.PLAN_CREATED);
    }
  });

  it("getValidEvents returns an empty array for a state with no entries in the transition table", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });
});
