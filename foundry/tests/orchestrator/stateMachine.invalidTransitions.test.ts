import { describe, it, expect } from "vitest";
import { transition } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine - invalid transitions", () => {
  it("throws StateTransitionError for a state with no entries in the transition table (Done is terminal)", () => {
    expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(StateTransitionError);
    try {
      transition(RunState.Done, RunEvent.RUN_REQUESTED);
      expect.unreachable("transition should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as StateTransitionError).fromState).toBe(RunState.Done);
      expect((err as StateTransitionError).event).toBe(RunEvent.RUN_REQUESTED);
      expect((err as StateTransitionError).message).toContain(RunState.Done);
    }
  });

  it("throws StateTransitionError for a known state with an event that has no mapped transition", () => {
    // Todo has entries in the table (RUN_REQUESTED, BLOCKED, NEEDS_HUMAN_CLARIFICATION)
    // but PLAN_APPROVED is not one of them, so the state map lookup succeeds while
    // the event lookup within it fails.
    expect(() => transition(RunState.Todo, RunEvent.PLAN_APPROVED)).toThrow(StateTransitionError);
    try {
      transition(RunState.Todo, RunEvent.PLAN_APPROVED);
      expect.unreachable("transition should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as StateTransitionError).fromState).toBe(RunState.Todo);
      expect((err as StateTransitionError).event).toBe(RunEvent.PLAN_APPROVED);
    }
  });
});
