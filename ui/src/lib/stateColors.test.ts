import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
  type StateCategory,
} from "./stateColors";

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
});

describe("getStateBadgeClass", () => {
  it("returns the badge classes for each category", () => {
    expect(getStateBadgeClass("Planning")).toContain("bg-state-active-bg");
    expect(getStateBadgeClass("AwaitingPlanApproval")).toContain("bg-state-waiting-bg");
    expect(getStateBadgeClass("AIBlocked")).toContain("bg-state-blocked-bg");
    expect(getStateBadgeClass("Done")).toContain("bg-state-done-bg");
    expect(getStateBadgeClass("Todo")).toContain("bg-state-idle-bg");
  });

  it("falls back to the idle badge class for an unknown state", () => {
    expect(getStateBadgeClass("Nonsense")).toContain("bg-state-idle-bg");
  });
});

describe("getStateDotClass", () => {
  it("returns the dot classes for each category", () => {
    expect(getStateDotClass("Planning")).toBe("bg-state-active");
    expect(getStateDotClass("AwaitingPlanApproval")).toBe("bg-state-waiting");
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
    expect(getStateDotClass("Done")).toBe("bg-state-done");
    expect(getStateDotClass("Todo")).toBe("bg-state-idle");
  });

  it("falls back to the idle dot class for an unknown state", () => {
    expect(getStateDotClass("Nonsense")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each capital letter and trims leading whitespace", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state name unchanged", () => {
    expect(formatStateName("Todo")).toBe("Todo");
  });

  it("handles an all-caps acronym by spacing every letter", () => {
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });
});
