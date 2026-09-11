import { describe, it, expect } from "vitest";
import { transition, getValidEvents } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine - invalid transition guards", () => {
  it("throws StateTransitionError when the current state has no entries in the transition table at all", () => {
    // RunState.Done is a terminal state that is never registered as a "from"
    // state anywhere in buildTransitionTable(), so TRANSITIONS.get(state)
    // returns undefined and the function must throw immediately.
    expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(
      StateTransitionError,
    );

    try {
      transition(RunState.Done, RunEvent.RUN_REQUESTED);
      throw new Error("expected transition() to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      const e = err as StateTransitionError;
      expect(e.fromState).toBe(RunState.Done);
      expect(e.event).toBe(RunEvent.RUN_REQUESTED);
      expect(e.message).toContain(RunState.Done);
      expect(e.message).toContain(RunEvent.RUN_REQUESTED);
    }
  });

  it("throws StateTransitionError when the state exists in the table but the event is not registered for it", () => {
    // RunState.Todo has a map (RUN_REQUESTED, BLOCKED, NEEDS_HUMAN_CLARIFICATION)
    // but PLAN_APPROVED is not one of its valid outgoing events.
    expect(() => transition(RunState.Todo, RunEvent.PLAN_APPROVED)).toThrow(
      StateTransitionError,
    );

    try {
      transition(RunState.Todo, RunEvent.PLAN_APPROVED);
      throw new Error("expected transition() to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      const e = err as StateTransitionError;
      expect(e.fromState).toBe(RunState.Todo);
      expect(e.event).toBe(RunEvent.PLAN_APPROVED);
    }
  });

  it("getValidEvents returns an empty array for a state absent from the transition table", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });

  it("getValidEvents returns the full set of registered events for a populated state", () => {
    const events = getValidEvents(RunState.Todo);
    expect(events).toContain(RunEvent.RUN_REQUESTED);
    expect(events).toContain(RunEvent.BLOCKED);
    expect(events).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
    expect(events).not.toContain(RunEvent.PLAN_APPROVED);
  });
});
