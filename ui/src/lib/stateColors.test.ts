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
  ] as const)("maps %s to category %s", (state, expected) => {
    expect(getStateCategory(state)).toBe(expected);
  });

  it("falls back to 'idle' for an unknown state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the active badge classes for an active state", () => {
    const result = getStateBadgeClass("Implementing");
    expect(result).toContain("state-active");
  });

  it("returns the blocked badge classes for a blocked state", () => {
    const result = getStateBadgeClass("AIBlocked");
    expect(result).toContain("state-blocked");
  });

  it("falls back to the idle badge classes for an unknown state", () => {
    const result = getStateBadgeClass("Nonsense");
    expect(result).toContain("state-idle");
  });
});

describe("getStateDotClass", () => {
  it("returns the done dot class for the Done state", () => {
    expect(getStateDotClass("Done")).toBe("bg-state-done");
  });

  it("returns the waiting dot class for a waiting state", () => {
    expect(getStateDotClass("ReadyForHumanReview")).toBe("bg-state-waiting");
  });

  it("falls back to the idle dot class for an unknown state", () => {
    expect(getStateDotClass("Nonsense")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts spaces before internal capital letters", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state unchanged", () => {
    expect(formatStateName("Done")).toBe("Done");
  });

  it("inserts a space before each capital letter, including runs of capitals", () => {
    expect(formatStateName("AIReview")).toBe("A I Review");
  });

  it("trims any leading whitespace produced by the substitution", () => {
    const result = formatStateName("AIBlocked");
    expect(result.startsWith(" ")).toBe(false);
    expect(result).toBe("A I Blocked");
  });
});
