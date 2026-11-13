import { describe, it, expect } from "vitest";
import { transition, getValidEvents } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine - error paths", () => {
  it("throws StateTransitionError for a state with no outgoing transitions at all", () => {
    // RunState.Done has no entries in the transition table (terminal state).
    expect(() => transition(RunState.Done, RunEvent.HUMAN_APPROVED)).toThrow(
      StateTransitionError,
    );
  });

  it("error for an unknown state includes the state and event in its fields", () => {
    try {
      transition(RunState.Done, RunEvent.RUN_REQUESTED);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      const e = err as StateTransitionError;
      expect(e.fromState).toBe(RunState.Done);
      expect(e.event).toBe(RunEvent.RUN_REQUESTED);
      expect(e.message).toContain(RunState.Done);
      expect(e.message).toContain(RunEvent.RUN_REQUESTED);
    }
  });

  it("throws StateTransitionError for a known state with an unsupported event", () => {
    // Todo has transitions for RUN_REQUESTED, BLOCKED and NEEDS_HUMAN_CLARIFICATION,
    // but not for PLAN_CREATED.
    expect(() => transition(RunState.Todo, RunEvent.PLAN_CREATED)).toThrow(
      StateTransitionError,
    );
  });

  it("error for a known state with an unsupported event includes state and event", () => {
    try {
      transition(RunState.Todo, RunEvent.PLAN_CREATED);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      const e = err as StateTransitionError;
      expect(e.fromState).toBe(RunState.Todo);
      expect(e.event).toBe(RunEvent.PLAN_CREATED);
    }
  });

  it("getValidEvents returns an empty array for a state absent from the table", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });
});
