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

  it.each(cases)("maps state %s to category %s", (state, category) => {
    expect(getStateCategory(state)).toBe(category);
  });

  it("falls back to 'idle' for an unknown state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });

  it("is case-sensitive (an unrecognized case variant falls back to idle)", () => {
    expect(getStateCategory("done")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the active badge classes for an active state", () => {
    const cls = getStateBadgeClass("Planning");
    expect(cls).toContain("bg-state-active-bg");
    expect(cls).toContain("text-state-active");
  });

  it("returns the waiting badge classes for a waiting state", () => {
    expect(getStateBadgeClass("ReadyForHumanReview")).toContain("bg-state-waiting-bg");
  });

  it("returns the blocked badge classes for a blocked state", () => {
    expect(getStateBadgeClass("AIBlocked")).toContain("bg-state-blocked-bg");
  });

  it("returns the done badge classes for a done state", () => {
    expect(getStateBadgeClass("Done")).toContain("bg-state-done-bg");
  });

  it("returns the idle badge classes for an unrecognized state", () => {
    expect(getStateBadgeClass("Nonsense")).toContain("bg-state-idle-bg");
  });
});

describe("getStateDotClass", () => {
  it("returns the matching dot class for each category", () => {
    expect(getStateDotClass("Planning")).toBe("bg-state-active");
    expect(getStateDotClass("ReadyForHumanReview")).toBe("bg-state-waiting");
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
    expect(getStateDotClass("Done")).toBe("bg-state-done");
    expect(getStateDotClass("Todo")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each interior capital letter", () => {
    expect(formatStateName("PlanReview")).toBe("Plan Review");
  });

  it("handles multi-word camel-cased state names", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state unchanged", () => {
    expect(formatStateName("Done")).toBe("Done");
  });

  it("trims any leading space produced by a leading capital", () => {
    // Every state starts with a capital letter, which would otherwise leave a leading space.
    expect(formatStateName("Todo")).toBe("Todo");
    expect(formatStateName("Todo")[0]).not.toBe(" ");
  });
});
