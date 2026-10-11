import { describe, it, expect } from "vitest";
import { transition, getValidEvents } from "../../src/orchestrator/stateMachine.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";

describe("stateMachine - edge cases", () => {
  describe("state with no table entry at all", () => {
    it("throws StateTransitionError when the current state has no outgoing transitions (Done is terminal)", () => {
      expect(() => transition(RunState.Done, RunEvent.RUN_REQUESTED)).toThrow(
        StateTransitionError,
      );
    });

    it("StateTransitionError for a stateless state carries the fromState and event", () => {
      try {
        transition(RunState.Done, RunEvent.HUMAN_APPROVED);
        expect.fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(StateTransitionError);
        const e = err as StateTransitionError;
        expect(e.fromState).toBe(RunState.Done);
        expect(e.event).toBe(RunEvent.HUMAN_APPROVED);
        expect(e.message).toContain(RunState.Done);
        expect(e.message).toContain(RunEvent.HUMAN_APPROVED);
      }
    });

    it("getValidEvents returns an empty array for a state with no table entry", () => {
      expect(getValidEvents(RunState.Done)).toEqual([]);
    });
  });

  describe("state exists in table but event is not valid for it", () => {
    it("throws StateTransitionError when the event is not a valid transition from a known state", () => {
      try {
        transition(RunState.Todo, RunEvent.PLAN_APPROVED);
        expect.fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(StateTransitionError);
        const e = err as StateTransitionError;
        expect(e.fromState).toBe(RunState.Todo);
        expect(e.event).toBe(RunEvent.PLAN_APPROVED);
      }
    });

    it("throws StateTransitionError for ReadyForHumanReview + an unsupported event", () => {
      expect(() =>
        transition(RunState.ReadyForHumanReview, RunEvent.RE_REVIEW_REQUESTED),
      ).toThrow(StateTransitionError);
    });

    it("getValidEvents for ReadyForHumanReview only contains HUMAN_APPROVED", () => {
      const events = getValidEvents(RunState.ReadyForHumanReview);
      expect(events).toEqual([RunEvent.HUMAN_APPROVED]);
    });
  });

  describe("happy-path transitions not covered elsewhere", () => {
    it("Todo + RUN_REQUESTED -> Planning", () => {
      expect(transition(RunState.Todo, RunEvent.RUN_REQUESTED)).toBe(RunState.Planning);
    });

    it("AIReview + REVIEW_APPROVED -> ReadyForHumanReview", () => {
      expect(transition(RunState.AIReview, RunEvent.REVIEW_APPROVED)).toBe(
        RunState.ReadyForHumanReview,
      );
    });

    it("ReadyForHumanReview + HUMAN_APPROVED -> Done", () => {
      expect(transition(RunState.ReadyForHumanReview, RunEvent.HUMAN_APPROVED)).toBe(
        RunState.Done,
      );
    });

    it("AwaitingPlanApproval + RE_REVIEW_REQUESTED -> PlanReview", () => {
      expect(transition(RunState.AwaitingPlanApproval, RunEvent.RE_REVIEW_REQUESTED)).toBe(
        RunState.PlanReview,
      );
    });
  });
});
