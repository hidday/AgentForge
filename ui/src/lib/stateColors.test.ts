import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
  type StateCategory,
} from "./stateColors.ts";

describe("getStateCategory", () => {
  const cases: Array<[string, StateCategory]> = [
    ["Todo", "idle"],
    ["Planning", "active"],
    ["PlanReview", "active"],
    ["PlanRevision", "active"],
    ["AwaitingPlanApproval", "waiting"],
    ["Implementing", "active"],
    ["AIReview", "active"],
    ["AddressingReview", "active"],
    ["ReadyForHumanReview", "waiting"],
    ["Done", "done"],
    ["AIBlocked", "blocked"],
    ["HumanClarificationNeeded", "waiting"],
  ];

  it.each(cases)("maps %s to %s", (state, category) => {
    expect(getStateCategory(state)).toBe(category);
  });

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
    expect(cls).toContain("bg-state-active-bg");
    expect(cls).toContain("text-state-active");
    expect(cls).toContain("border-state-active/30");
  });

  it("returns the waiting badge classes for a waiting state", () => {
    const cls = getStateBadgeClass("AwaitingPlanApproval");
    expect(cls).toContain("bg-state-waiting-bg");
  });

  it("returns the blocked badge classes for a blocked state", () => {
    const cls = getStateBadgeClass("AIBlocked");
    expect(cls).toContain("bg-state-blocked-bg");
  });

  it("returns the done badge classes for a done state", () => {
    const cls = getStateBadgeClass("Done");
    expect(cls).toContain("bg-state-done-bg");
  });

  it("returns the idle badge classes for an unknown state", () => {
    const cls = getStateBadgeClass("NotAState");
    expect(cls).toContain("bg-state-idle-bg");
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
    expect(getStateDotClass("Unmapped")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts spaces before capital letters in a PascalCase name", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word name unchanged (no trailing/leading space)", () => {
    expect(formatStateName("Todo")).toBe("Todo");
  });

  it("inserts a space before each capital letter, including consecutive ones", () => {
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("handles an empty string", () => {
    expect(formatStateName("")).toBe("");
  });
});
