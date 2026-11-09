import { describe, it, expect } from "vitest";
import { transition, getValidEvents } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine - invalid transition branches", () => {
  it("throws StateTransitionError when the current state has no entries in the table at all", () => {
    // RunState.Done is a terminal state with no outgoing transitions registered.
    expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(
      StateTransitionError,
    );
    try {
      transition(RunState.Done, RunEvent.RUN_REQUESTED);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as StateTransitionError).fromState).toBe(RunState.Done);
      expect((err as StateTransitionError).event).toBe(RunEvent.RUN_REQUESTED);
      expect((err as StateTransitionError).message).toContain(RunState.Done);
      expect((err as StateTransitionError).message).toContain(RunEvent.RUN_REQUESTED);
    }
  });

  it("throws StateTransitionError when the state exists but the event is not valid for it", () => {
    // RunState.Todo has registered transitions, but not for PLAN_APPROVED.
    expect(() => transition(RunState.Todo, RunEvent.PLAN_APPROVED)).toThrow(
      StateTransitionError,
    );
    try {
      transition(RunState.Todo, RunEvent.PLAN_APPROVED);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as StateTransitionError).fromState).toBe(RunState.Todo);
      expect((err as StateTransitionError).event).toBe(RunEvent.PLAN_APPROVED);
    }
  });

  it("getValidEvents returns an empty array for a state with no outgoing transitions", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });

  it("getValidEvents returns the registered events for a state that has transitions", () => {
    const events = getValidEvents(RunState.Todo);
    expect(events).toContain(RunEvent.RUN_REQUESTED);
    expect(events).toContain(RunEvent.BLOCKED);
    expect(events).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
    expect(events).not.toContain(RunEvent.PLAN_APPROVED);
  });

  it("a valid transition still succeeds (happy path sanity check)", () => {
    expect(transition(RunState.Todo, RunEvent.RUN_REQUESTED)).toBe(RunState.Planning);
  });
});
