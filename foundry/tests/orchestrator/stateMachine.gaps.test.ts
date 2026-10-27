import { describe, it, expect } from "vitest";
import { transition, getValidEvents } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine - uncovered error branches", () => {
  it("throws StateTransitionError when the current state has no entries in the transition table at all (e.g. terminal Done state)", () => {
    // RunState.Done is never added as a "from" state in the transition table,
    // so stateMap is undefined and the function must hit the first throw branch.
    expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(StateTransitionError);
    try {
      transition(RunState.Done, RunEvent.RUN_REQUESTED);
      throw new Error("expected transition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as StateTransitionError).fromState).toBe(RunState.Done);
      expect((err as StateTransitionError).event).toBe(RunEvent.RUN_REQUESTED);
      expect((err as StateTransitionError).message).toBe(
        `No transition from state "${RunState.Done}" for event "${RunEvent.RUN_REQUESTED}"`,
      );
    }
  });

  it("getValidEvents returns an empty array for a state with no entries in the transition table", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });

  it("throws StateTransitionError when the current state is known but the event is not valid for it", () => {
    // RunState.Todo has entries in the table, but PLAN_CREATED is not one of its valid events,
    // so stateMap exists but stateMap.get(event) is undefined -- the second throw branch.
    expect(() => transition(RunState.Todo, RunEvent.PLAN_CREATED)).toThrow(StateTransitionError);
    try {
      transition(RunState.Todo, RunEvent.PLAN_CREATED);
      throw new Error("expected transition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as StateTransitionError).fromState).toBe(RunState.Todo);
      expect((err as StateTransitionError).event).toBe(RunEvent.PLAN_CREATED);
    }
  });

  it("getValidEvents for Todo does not include an event invalid for that state", () => {
    const validEvents = getValidEvents(RunState.Todo);
    expect(validEvents).not.toContain(RunEvent.PLAN_CREATED);
    expect(validEvents).toContain(RunEvent.RUN_REQUESTED);
  });
});
