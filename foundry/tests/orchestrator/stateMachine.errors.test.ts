import { describe, it, expect } from "vitest";
import { transition, getValidEvents } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine - error branches", () => {
  it("throws StateTransitionError when the state has no outgoing transitions at all", () => {
    // RunState.Done is a terminal state with no entries in the transition table.
    expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(StateTransitionError);
    try {
      transition(RunState.Done, RunEvent.RUN_REQUESTED);
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as StateTransitionError).fromState).toBe(RunState.Done);
      expect((err as StateTransitionError).event).toBe(RunEvent.RUN_REQUESTED);
      expect((err as Error).message).toContain(RunState.Done);
      expect((err as Error).message).toContain(RunEvent.RUN_REQUESTED);
    }
  });

  it("throws StateTransitionError when the state exists but the event is not valid for it", () => {
    // Todo has transitions defined, but not for HUMAN_APPROVED.
    expect(() => transition(RunState.Todo, RunEvent.HUMAN_APPROVED)).toThrow(StateTransitionError);
    try {
      transition(RunState.Todo, RunEvent.HUMAN_APPROVED);
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as StateTransitionError).fromState).toBe(RunState.Todo);
      expect((err as StateTransitionError).event).toBe(RunEvent.HUMAN_APPROVED);
    }
  });

  it("getValidEvents returns an empty array for a state with no outgoing transitions", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });
});
