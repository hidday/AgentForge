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

describe("stateMachine - invalid transition guards", () => {
  it("throws StateTransitionError for a state with no table entry at all (Done has no outgoing transitions)", () => {
    expect(() => transition(RunState.Done, RunEvent.RESET_TO_TODO)).toThrow(StateTransitionError);
    try {
      transition(RunState.Done, RunEvent.RESET_TO_TODO);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as StateTransitionError).fromState).toBe(RunState.Done);
      expect((err as StateTransitionError).event).toBe(RunEvent.RESET_TO_TODO);
      expect((err as StateTransitionError).message).toContain(RunState.Done);
      expect((err as StateTransitionError).message).toContain(RunEvent.RESET_TO_TODO);
    }
  });

  it("throws StateTransitionError for a known state with an event that is not registered for it", () => {
    // Todo has entries in the table (RUN_REQUESTED, BLOCKED, NEEDS_HUMAN_CLARIFICATION)
    // but not HUMAN_APPROVED, so the stateMap exists but the event lookup misses.
    expect(() => transition(RunState.Todo, RunEvent.HUMAN_APPROVED)).toThrow(StateTransitionError);
    try {
      transition(RunState.Todo, RunEvent.HUMAN_APPROVED);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as StateTransitionError).fromState).toBe(RunState.Todo);
      expect((err as StateTransitionError).event).toBe(RunEvent.HUMAN_APPROVED);
    }
  });

  it("getValidEvents returns an empty array for a state with no table entry (Done)", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });

  it("getValidEvents returns the full registered event list for a populated state (Todo)", () => {
    const validEvents = getValidEvents(RunState.Todo);
    expect(validEvents).toContain(RunEvent.RUN_REQUESTED);
    expect(validEvents).toContain(RunEvent.BLOCKED);
    expect(validEvents).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
    expect(validEvents).not.toContain(RunEvent.HUMAN_APPROVED);
  });
});
