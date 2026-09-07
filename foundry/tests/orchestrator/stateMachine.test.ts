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

describe("stateMachine - error and boundary paths", () => {
  it("throws StateTransitionError when the current state has no outgoing transitions at all", () => {
    // RunState.Done is a terminal state never added as a "from" state in the
    // transition table, so the table lookup itself misses.
    expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(StateTransitionError);
  });

  it("throws StateTransitionError when the event is not valid for a known state", () => {
    // Todo has entries in the table, but PLAN_APPROVED is not one of its events.
    expect(() => transition(RunState.Todo, RunEvent.PLAN_APPROVED)).toThrow(StateTransitionError);
  });

  it("StateTransitionError carries the offending state and event", () => {
    try {
      transition(RunState.Todo, RunEvent.PLAN_APPROVED);
      throw new Error("expected transition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as Error).message).toContain(RunState.Todo);
      expect((err as Error).message).toContain(RunEvent.PLAN_APPROVED);
    }
  });

  it("getValidEvents returns an empty array for a state absent from the transition table", () => {
    const validEvents = getValidEvents(RunState.Done);
    expect(validEvents).toEqual([]);
  });

  it("getValidEvents returns the exact set of events for a state present in the table", () => {
    const validEvents = getValidEvents(RunState.ReadyForHumanReview);
    expect(validEvents).toEqual([RunEvent.HUMAN_APPROVED]);
  });
});
