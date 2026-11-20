import { describe, it, expect } from "vitest";
import { transition, getValidEvents } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine - transition error branches", () => {
  it("throws StateTransitionError when the current state has no outgoing transitions at all", () => {
    // RunState.Done is a terminal state never used as a transition source.
    expect(() => transition(RunState.Done, RunEvent.HUMAN_APPROVED)).toThrow(
      StateTransitionError,
    );
  });

  it("includes the from-state and event in the error when no stateMap exists", () => {
    try {
      transition(RunState.Done, RunEvent.RUN_REQUESTED);
      throw new Error("expected transition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as StateTransitionError).fromState).toBe(RunState.Done);
      expect((err as StateTransitionError).event).toBe(RunEvent.RUN_REQUESTED);
    }
  });

  it("throws StateTransitionError when the state has a transition table but not for this event", () => {
    // Todo has outgoing transitions (RUN_REQUESTED, BLOCKED, NEEDS_HUMAN_CLARIFICATION)
    // but not HUMAN_APPROVED.
    expect(() => transition(RunState.Todo, RunEvent.HUMAN_APPROVED)).toThrow(
      StateTransitionError,
    );
  });

  it("reports the correct fromState/event when the event is simply invalid for a known state", () => {
    try {
      transition(RunState.Implementing, RunEvent.PLAN_APPROVED);
      throw new Error("expected transition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as StateTransitionError).fromState).toBe(RunState.Implementing);
      expect((err as StateTransitionError).event).toBe(RunEvent.PLAN_APPROVED);
    }
  });

  it("getValidEvents returns an empty array for a state with no outgoing transitions", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });

  it("getValidEvents returns the full valid event set for a known state", () => {
    const events = getValidEvents(RunState.Todo);
    expect(events).toContain(RunEvent.RUN_REQUESTED);
    expect(events).toContain(RunEvent.BLOCKED);
    expect(events).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
    expect(events).not.toContain(RunEvent.HUMAN_APPROVED);
  });
});
