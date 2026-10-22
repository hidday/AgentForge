import { describe, it, expect } from "vitest";
import { transition } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine - invalid transitions", () => {
  it("throws StateTransitionError when the current state has no outgoing transitions at all", () => {
    // RunState.Done is terminal: it has no entry in the transition table.
    expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(StateTransitionError);
  });

  it("throws StateTransitionError when the current state is known but the event is not a valid transition from it", () => {
    // RunState.Todo exists in the table, but PLAN_CREATED is not one of its events.
    expect(() => transition(RunState.Todo, RunEvent.PLAN_CREATED)).toThrow(StateTransitionError);
  });

  it("includes the offending state and event in the thrown error", () => {
    try {
      transition(RunState.Done, RunEvent.RUN_REQUESTED);
      expect.fail("expected transition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as Error).message).toContain(RunState.Done);
      expect((err as Error).message).toContain(RunEvent.RUN_REQUESTED);
    }
  });
});
