import { describe, it, expect } from "vitest";
import { transition, getValidEvents } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine - clarification transitions", () => {
  it("HumanClarificationNeeded + CLARIFICATION_PROVIDED → Planning", () => {
    const next = transition(RunState.HumanClarificationNeeded, RunEvent.CLARIFICATION_PROVIDED);
    expect(next).toBe(RunState.Planning);
  });

  it("HumanClarificationNeeded + CLARIFICATION_EXHAUSTED → Failed", () => {
    const next = transition(RunState.HumanClarificationNeeded, RunEvent.CLARIFICATION_EXHAUSTED);
    expect(next).toBe(RunState.Failed);
  });

  it("HumanClarificationNeeded + RESET_TO_TODO → Todo (existing behaviour preserved)", () => {
    const next = transition(RunState.HumanClarificationNeeded, RunEvent.RESET_TO_TODO);
    expect(next).toBe(RunState.Todo);
  });

  it("getValidEvents for HumanClarificationNeeded includes CLARIFICATION_PROVIDED and RESET_TO_TODO", () => {
    const validEvents = getValidEvents(RunState.HumanClarificationNeeded);
    expect(validEvents).toContain(RunEvent.CLARIFICATION_PROVIDED);
    expect(validEvents).toContain(RunEvent.RESET_TO_TODO);
  });

  it("getValidEvents for HumanClarificationNeeded includes CLARIFICATION_EXHAUSTED", () => {
    const validEvents = getValidEvents(RunState.HumanClarificationNeeded);
    expect(validEvents).toContain(RunEvent.CLARIFICATION_EXHAUSTED);
  });

  it("Failed allows RESET_TO_TODO to recover", () => {
    const next = transition(RunState.Failed, RunEvent.RESET_TO_TODO);
    expect(next).toBe(RunState.Todo);
  });

  it("Failed has only RESET_TO_TODO as outgoing transition", () => {
    const validEvents = getValidEvents(RunState.Failed);
    expect(validEvents).toHaveLength(1);
    expect(validEvents).toContain(RunEvent.RESET_TO_TODO);
  });
});

describe("stateMachine - invalid transitions", () => {
  it("throws StateTransitionError when the current state has no outgoing transitions at all", () => {
    // RunState.Done is a terminal state with no entries in the transition table,
    // so the lookup for its state map itself fails (distinct from an unmapped event).
    expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(StateTransitionError);
    try {
      transition(RunState.Done, RunEvent.RUN_REQUESTED);
      throw new Error("expected transition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      const stateErr = err as StateTransitionError;
      expect(stateErr.fromState).toBe(RunState.Done);
      expect(stateErr.event).toBe(RunEvent.RUN_REQUESTED);
      expect(stateErr.message).toBe(
        `No transition from state "${RunState.Done}" for event "${RunEvent.RUN_REQUESTED}"`,
      );
    }
  });

  it("throws StateTransitionError when the current state has transitions but not for the given event", () => {
    // RunState.Todo has a state map (RUN_REQUESTED, BLOCKED, NEEDS_HUMAN_CLARIFICATION)
    // but no entry for HUMAN_APPROVED, exercising the "event not found" branch.
    expect(() => transition(RunState.Todo, RunEvent.HUMAN_APPROVED)).toThrow(StateTransitionError);
    try {
      transition(RunState.Todo, RunEvent.HUMAN_APPROVED);
      throw new Error("expected transition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      const stateErr = err as StateTransitionError;
      expect(stateErr.fromState).toBe(RunState.Todo);
      expect(stateErr.event).toBe(RunEvent.HUMAN_APPROVED);
    }
  });

  it("getValidEvents returns an empty array for a state with no transition table entry", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });
});
