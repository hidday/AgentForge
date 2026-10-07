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

describe("stateMachine - unknown state / unknown event branches", () => {
  it("throws StateTransitionError for a state with no entries in the transition table (Done is terminal)", () => {
    expect(() => transition(RunState.Done, RunEvent.RESET_TO_TODO)).toThrow(StateTransitionError);
    try {
      transition(RunState.Done, RunEvent.RESET_TO_TODO);
      throw new Error("expected transition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as StateTransitionError).fromState).toBe(RunState.Done);
      expect((err as StateTransitionError).event).toBe(RunEvent.RESET_TO_TODO);
    }
  });

  it("getValidEvents returns an empty array for a state with no entries in the table", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });

  it("throws StateTransitionError for a valid state but an event not registered for it", () => {
    let caught: StateTransitionError | undefined;
    try {
      transition(RunState.Todo, RunEvent.PLAN_APPROVED);
    } catch (err) {
      caught = err as StateTransitionError;
    }
    expect(caught).toBeInstanceOf(StateTransitionError);
    expect(caught?.fromState).toBe(RunState.Todo);
    expect(caught?.event).toBe(RunEvent.PLAN_APPROVED);
    expect(caught?.message).toContain(RunState.Todo);
    expect(caught?.message).toContain(RunEvent.PLAN_APPROVED);
  });

  it("getValidEvents for Todo lists exactly its registered outgoing events", () => {
    const validEvents = getValidEvents(RunState.Todo);
    expect(new Set(validEvents)).toEqual(
      new Set([RunEvent.RUN_REQUESTED, RunEvent.BLOCKED, RunEvent.NEEDS_HUMAN_CLARIFICATION]),
    );
  });
});
