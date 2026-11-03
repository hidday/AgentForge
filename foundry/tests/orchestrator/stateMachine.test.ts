import { describe, it, expect } from "vitest";
import { transition, getValidEvents } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

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
  it("throws StateTransitionError for a state with no outgoing transitions at all", () => {
    expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(
      'No transition from state "Done" for event "RUN_REQUESTED"',
    );
  });

  it("getValidEvents returns an empty array for a terminal state with no transition map", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });

  it("throws StateTransitionError when the event is not valid for a known state", () => {
    expect(() => transition(RunState.Todo, RunEvent.PLAN_APPROVED)).toThrow(
      'No transition from state "Todo" for event "PLAN_APPROVED"',
    );
  });

  it("thrown StateTransitionError carries the fromState and event fields", () => {
    try {
      transition(RunState.Todo, RunEvent.PLAN_APPROVED);
      throw new Error("expected transition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as { fromState: string }).fromState).toBe(RunState.Todo);
      expect((err as { event: string }).event).toBe(RunEvent.PLAN_APPROVED);
    }
  });
});
