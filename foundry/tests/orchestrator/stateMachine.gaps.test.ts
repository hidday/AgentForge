import { describe, it, expect } from "vitest";
import { transition } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine - error paths", () => {
  it("throws StateTransitionError for a state with no transitions defined at all", () => {
    expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(StateTransitionError);
    try {
      transition(RunState.Done, RunEvent.RUN_REQUESTED);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as StateTransitionError).fromState).toBe(RunState.Done);
      expect((err as StateTransitionError).event).toBe(RunEvent.RUN_REQUESTED);
    }
  });

  it("throws StateTransitionError for a known state with an unregistered event", () => {
    expect(() => transition(RunState.Todo, RunEvent.PLAN_CREATED)).toThrow(StateTransitionError);
    try {
      transition(RunState.Todo, RunEvent.PLAN_CREATED);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as StateTransitionError).fromState).toBe(RunState.Todo);
      expect((err as StateTransitionError).event).toBe(RunEvent.PLAN_CREATED);
    }
  });
});
