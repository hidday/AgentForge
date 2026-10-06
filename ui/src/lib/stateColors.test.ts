import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
  type StateCategory,
} from "./stateColors";

describe("getStateCategory", () => {
  const expected: Record<string, StateCategory> = {
    Todo: "idle",
    Planning: "active",
    PlanReview: "active",
    PlanRevision: "active",
    AwaitingPlanApproval: "waiting",
    Implementing: "active",
    AIReview: "active",
    AddressingReview: "active",
    ReadyForHumanReview: "waiting",
    Done: "done",
    AIBlocked: "blocked",
    HumanClarificationNeeded: "waiting",
  };

  for (const [state, category] of Object.entries(expected)) {
    it(`maps "${state}" to "${category}"`, () => {
      expect(getStateCategory(state)).toBe(category);
    });
  }

  it("falls back to 'idle' for an unknown state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });

  it("falls back to 'idle' for an empty string", () => {
    expect(getStateCategory("")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the active badge classes for an active state", () => {
    const cls = getStateBadgeClass("Planning");
    expect(cls).toBe("bg-state-active-bg text-state-active border-state-active/30");
  });

  it("returns the waiting badge classes for a waiting state", () => {
    const cls = getStateBadgeClass("AwaitingPlanApproval");
    expect(cls).toBe("bg-state-waiting-bg text-state-waiting border-state-waiting/30");
  });

  it("returns the blocked badge classes for a blocked state", () => {
    const cls = getStateBadgeClass("AIBlocked");
    expect(cls).toBe("bg-state-blocked-bg text-state-blocked border-state-blocked/30");
  });

  it("returns the done badge classes for a done state", () => {
    const cls = getStateBadgeClass("Done");
    expect(cls).toBe("bg-state-done-bg text-state-done border-state-done/30");
  });

  it("returns the idle badge classes for an unknown state", () => {
    const cls = getStateBadgeClass("NotAState");
    expect(cls).toBe("bg-state-idle-bg text-state-idle border-state-idle/30");
  });
});

describe("getStateDotClass", () => {
  it("returns the active dot class for an active state", () => {
    expect(getStateDotClass("Implementing")).toBe("bg-state-active");
  });

  it("returns the waiting dot class for a waiting state", () => {
    expect(getStateDotClass("ReadyForHumanReview")).toBe("bg-state-waiting");
  });

  it("returns the blocked dot class for a blocked state", () => {
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
  });

  it("returns the done dot class for a done state", () => {
    expect(getStateDotClass("Done")).toBe("bg-state-done");
  });

  it("returns the idle dot class for an unknown state", () => {
    expect(getStateDotClass("Mystery")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each interior capital letter", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word, all-lowercase-after-first state unchanged aside from trimming", () => {
    expect(formatStateName("Todo")).toBe("Todo");
  });

  it("handles a state made of multiple capitalized words", () => {
    expect(formatStateName("AIReview")).toBe("A I Review");
  });

  it("returns an empty string for empty input", () => {
    expect(formatStateName("")).toBe("");
  });
});
