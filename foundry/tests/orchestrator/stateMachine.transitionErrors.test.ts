import { describe, it, expect } from "vitest";
import { transition, getValidEvents } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine - invalid transitions", () => {
  it("throws StateTransitionError when the current state has no transitions defined at all", () => {
    // RunState.Done is terminal and has no outgoing transitions in the table.
    expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(
      StateTransitionError,
    );
  });

  it("includes the offending state and event on the error when there is no transition table entry", () => {
    try {
      transition(RunState.Done, RunEvent.PLAN_CREATED);
      expect.unreachable("expected transition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      const transitionError = err as StateTransitionError;
      expect(transitionError.fromState).toBe(RunState.Done);
      expect(transitionError.event).toBe(RunEvent.PLAN_CREATED);
      expect(transitionError.message).toContain(RunState.Done);
      expect(transitionError.message).toContain(RunEvent.PLAN_CREATED);
    }
  });

  it("getValidEvents returns an empty array for a state with no transition table entry", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });

  it("throws StateTransitionError when the state exists in the table but the event is not valid for it", () => {
    // RunState.Todo has transitions, but PLAN_CREATED is not one of its valid events.
    expect(() => transition(RunState.Todo, RunEvent.PLAN_CREATED)).toThrow(
      StateTransitionError,
    );
  });

  it("includes the offending state and event on the error when the event is not valid for that state", () => {
    try {
      transition(RunState.Todo, RunEvent.PLAN_CREATED);
      expect.unreachable("expected transition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      const transitionError = err as StateTransitionError;
      expect(transitionError.fromState).toBe(RunState.Todo);
      expect(transitionError.event).toBe(RunEvent.PLAN_CREATED);
    }
  });

  it("getValidEvents for a known state does not include an unrelated event", () => {
    const validEvents = getValidEvents(RunState.Todo);
    expect(validEvents).not.toContain(RunEvent.PLAN_CREATED);
    expect(validEvents.length).toBeGreaterThan(0);
  });
});
