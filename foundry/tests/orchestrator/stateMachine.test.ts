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
  it("throws StateTransitionError for a state with no entries in the transition table", () => {
    // Done is a terminal state with no outgoing transitions at all, so the
    // table has no entry (stateMap undefined) for it.
    expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(
      StateTransitionError,
    );
  });

  it("throws StateTransitionError carrying the fromState and event for an unknown-state transition", () => {
    try {
      transition(RunState.Done, RunEvent.RUN_REQUESTED);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as StateTransitionError).fromState).toBe(RunState.Done);
      expect((err as StateTransitionError).event).toBe(RunEvent.RUN_REQUESTED);
    }
  });

  it("throws StateTransitionError for a known state with an event it does not accept", () => {
    // Todo has a stateMap (RUN_REQUESTED, BLOCKED, NEEDS_HUMAN_CLARIFICATION)
    // but not PLAN_APPROVED, so nextState lookup misses.
    expect(() => transition(RunState.Todo, RunEvent.PLAN_APPROVED)).toThrow(
      StateTransitionError,
    );
  });

  it("getValidEvents returns an empty array for a state with no outgoing transitions", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });

  it("getValidEvents returns the single outgoing event for ReadyForHumanReview", () => {
    expect(getValidEvents(RunState.ReadyForHumanReview)).toEqual([
      RunEvent.HUMAN_APPROVED,
    ]);
  });
});
