import { describe, it, expect } from "vitest";
import { transition, getValidEvents } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine - undefined transitions (terminal/unmapped states and events)", () => {
  it("throws StateTransitionError when the FROM state has no entry in the transition table at all", () => {
    // RunState.Done is a terminal state with no outgoing transitions registered.
    expect(() => transition(RunState.Done, RunEvent.RESET_TO_TODO)).toThrow(
      StateTransitionError,
    );
  });

  it("carries the correct fromState/event on the error when the state has no table entry", () => {
    try {
      transition(RunState.Done, RunEvent.RUN_REQUESTED);
      throw new Error("expected transition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as StateTransitionError).fromState).toBe(RunState.Done);
      expect((err as StateTransitionError).event).toBe(RunEvent.RUN_REQUESTED);
      expect((err as StateTransitionError).message).toContain('"Done"');
      expect((err as StateTransitionError).message).toContain("RUN_REQUESTED");
    }
  });

  it("getValidEvents returns an empty array for a state with no table entry", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });

  it("throws StateTransitionError when the FROM state exists but the event is not mapped for it", () => {
    // RunState.Todo has outgoing transitions, but HUMAN_REQUESTED is not one of them.
    expect(() => transition(RunState.Todo, RunEvent.HUMAN_REQUESTED)).toThrow(
      StateTransitionError,
    );
  });

  it("carries the correct fromState/event on the error when the event is unmapped for a known state", () => {
    try {
      transition(RunState.Implementing, RunEvent.PLAN_APPROVED);
      throw new Error("expected transition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as StateTransitionError).fromState).toBe(RunState.Implementing);
      expect((err as StateTransitionError).event).toBe(RunEvent.PLAN_APPROVED);
    }
  });

  it("getValidEvents for a known state does not include an event that has no mapping", () => {
    const validEvents = getValidEvents(RunState.Todo);
    expect(validEvents.length).toBeGreaterThan(0);
    expect(validEvents).not.toContain(RunEvent.HUMAN_REQUESTED);
  });
});
