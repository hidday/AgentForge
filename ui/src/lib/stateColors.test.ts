import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
} from "./stateColors.ts";

describe("getStateCategory", () => {
  it.each([
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
  ] as const)("maps %s to %s", (state, category) => {
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
    const cls = getStateBadgeClass("Implementing");
    expect(cls).toContain("bg-state-active-bg");
    expect(cls).toContain("text-state-active");
  });

  it("returns the waiting badge classes for a waiting state", () => {
    const cls = getStateBadgeClass("ReadyForHumanReview");
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
    const cls = getStateBadgeClass("NotARealState");
    expect(cls).toContain("bg-state-idle-bg");
  });
});

describe("getStateDotClass", () => {
  it("returns the active dot class for an active state", () => {
    expect(getStateDotClass("Planning")).toBe("bg-state-active");
  });

  it("returns the waiting dot class for a waiting state", () => {
    expect(getStateDotClass("AwaitingPlanApproval")).toBe("bg-state-waiting");
  });

  it("returns the blocked dot class for a blocked state", () => {
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
  });

  it("returns the done dot class for a done state", () => {
    expect(getStateDotClass("Done")).toBe("bg-state-done");
  });

  it("returns the idle dot class for an unknown state", () => {
    expect(getStateDotClass("Nonsense")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each capital letter and trims", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state unchanged (no trailing space)", () => {
    expect(formatStateName("Done")).toBe("Done");
  });

  it("handles a state with many capitals in a row producing separated words", () => {
    expect(formatStateName("AIBlocked")).toBe("AIBlocked".replace(/([A-Z])/g, " $1").trim());
    // explicit expected value for clarity
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("returns an empty string for an empty input", () => {
    expect(formatStateName("")).toBe("");
  });
});
