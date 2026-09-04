import { describe, it, expect } from "vitest";
import { transition, getValidEvents } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine - error paths and terminal/unlisted states", () => {
  it("throws StateTransitionError when the current state has no entry in the transition table at all", () => {
    // RunState.Done is a terminal state with no outgoing transitions defined,
    // so the table has no Map entry for it (covers the `if (!stateMap)` branch).
    expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(StateTransitionError);
    try {
      transition(RunState.Done, RunEvent.RUN_REQUESTED);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as StateTransitionError).fromState).toBe(RunState.Done);
      expect((err as StateTransitionError).event).toBe(RunEvent.RUN_REQUESTED);
      expect((err as StateTransitionError).message).toContain("Done");
      expect((err as StateTransitionError).message).toContain("RUN_REQUESTED");
    }
  });

  it("throws StateTransitionError when the state exists in the table but the event is not a valid transition for it", () => {
    // RunState.Todo has entries for RUN_REQUESTED, BLOCKED, and
    // NEEDS_HUMAN_CLARIFICATION, but not for e.g. HUMAN_APPROVED
    // (covers the `if (nextState === undefined)` branch).
    expect(() => transition(RunState.Todo, RunEvent.HUMAN_APPROVED)).toThrow(
      StateTransitionError,
    );
    try {
      transition(RunState.Todo, RunEvent.HUMAN_APPROVED);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as StateTransitionError).fromState).toBe(RunState.Todo);
      expect((err as StateTransitionError).event).toBe(RunEvent.HUMAN_APPROVED);
    }
  });

  it("getValidEvents returns an empty array for a state with no table entry", () => {
    expect(getValidEvents(RunState.Done)).toEqual([]);
  });

  it("getValidEvents returns the exact set of valid outgoing events for a state with transitions", () => {
    const events = getValidEvents(RunState.Todo);
    expect(events).toContain(RunEvent.RUN_REQUESTED);
    expect(events).toContain(RunEvent.BLOCKED);
    expect(events).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
    expect(events).toHaveLength(3);
  });

  it("supports the full happy-path run lifecycle end to end", () => {
    let state = RunState.Todo;
    state = transition(state, RunEvent.RUN_REQUESTED);
    expect(state).toBe(RunState.Planning);
    state = transition(state, RunEvent.PLAN_CREATED);
    expect(state).toBe(RunState.PlanReview);
    state = transition(state, RunEvent.PLAN_REVIEW_APPROVED);
    expect(state).toBe(RunState.AwaitingPlanApproval);
    state = transition(state, RunEvent.PLAN_APPROVED);
    expect(state).toBe(RunState.Implementing);
    state = transition(state, RunEvent.EXECUTION_FINISHED);
    expect(state).toBe(RunState.AIReview);
    state = transition(state, RunEvent.REVIEW_APPROVED);
    expect(state).toBe(RunState.ReadyForHumanReview);
    state = transition(state, RunEvent.HUMAN_APPROVED);
    expect(state).toBe(RunState.Done);
  });

  it("EXECUTION_STARTED is a self-loop on Implementing", () => {
    expect(transition(RunState.Implementing, RunEvent.EXECUTION_STARTED)).toBe(
      RunState.Implementing,
    );
  });

  it("plan review changes-requested routes through PlanRevision back to AwaitingPlanApproval", () => {
    let state = transition(RunState.PlanReview, RunEvent.PLAN_REVIEW_CHANGES_REQUESTED);
    expect(state).toBe(RunState.PlanRevision);
    state = transition(state, RunEvent.PLAN_REVISED);
    expect(state).toBe(RunState.AwaitingPlanApproval);
  });

  it("AwaitingPlanApproval + PLAN_REJECTED returns to Planning", () => {
    expect(transition(RunState.AwaitingPlanApproval, RunEvent.PLAN_REJECTED)).toBe(
      RunState.Planning,
    );
  });

  it("AwaitingPlanApproval + RE_REVIEW_REQUESTED returns to PlanReview", () => {
    expect(transition(RunState.AwaitingPlanApproval, RunEvent.RE_REVIEW_REQUESTED)).toBe(
      RunState.PlanReview,
    );
  });

  it("AIReview + REVIEW_CHANGES_REQUESTED routes to AddressingReview, and REMEDIATION_FINISHED loops back to AIReview", () => {
    let state = transition(RunState.AIReview, RunEvent.REVIEW_CHANGES_REQUESTED);
    expect(state).toBe(RunState.AddressingReview);
    state = transition(state, RunEvent.REMEDIATION_FINISHED);
    expect(state).toBe(RunState.AIReview);
  });

  it("every active state can be BLOCKED into AIBlocked, and AIBlocked recovers via RESET_TO_TODO", () => {
    const blockable = [
      RunState.Todo,
      RunState.Planning,
      RunState.PlanReview,
      RunState.PlanRevision,
      RunState.AwaitingPlanApproval,
      RunState.Implementing,
      RunState.AIReview,
      RunState.AddressingReview,
    ];
    for (const state of blockable) {
      expect(transition(state, RunEvent.BLOCKED)).toBe(RunState.AIBlocked);
    }
    expect(transition(RunState.AIBlocked, RunEvent.RESET_TO_TODO)).toBe(RunState.Todo);
  });

  it("ReadyForHumanReview and Done are terminal-ish with no BLOCKED transition defined", () => {
    expect(() => transition(RunState.ReadyForHumanReview, RunEvent.BLOCKED)).toThrow(
      StateTransitionError,
    );
    expect(() => transition(RunState.Done, RunEvent.BLOCKED)).toThrow(StateTransitionError);
  });

  it("PlanReview + CLARIFICATION_EXHAUSTED routes directly to Failed", () => {
    expect(transition(RunState.PlanReview, RunEvent.CLARIFICATION_EXHAUSTED)).toBe(
      RunState.Failed,
    );
  });
});
