import { describe, it, expect } from "vitest";
import { transition, getValidEvents } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine - invalid transitions", () => {
  it("throws when the current state has no outgoing transitions at all", () => {
    expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(StateTransitionError);
    try {
      transition(RunState.Done, RunEvent.RUN_REQUESTED);
      expect.unreachable();
    } catch (err) {
      expect((err as StateTransitionError).fromState).toBe(RunState.Done);
      expect((err as StateTransitionError).event).toBe(RunEvent.RUN_REQUESTED);
    }
  });

  it("throws when the event is not valid for the current state", () => {
    expect(() => transition(RunState.Todo, RunEvent.PLAN_CREATED)).toThrow(StateTransitionError);
  });

  it("getValidEvents returns an empty array for a state with no outgoing transitions", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });
});

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
