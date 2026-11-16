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
  ])("maps %s to %s", (state, category) => {
    expect(getStateCategory(state)).toBe(category);
  });

  it("falls back to idle for an unknown state", () => {
    expect(getStateCategory("SomeMadeUpState")).toBe("idle");
  });

  it("falls back to idle for an empty string", () => {
    expect(getStateCategory("")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the active badge classes for an active state", () => {
    const result = getStateBadgeClass("Implementing");
    expect(result).toContain("bg-state-active-bg");
    expect(result).toContain("text-state-active");
  });

  it("returns the blocked badge classes for a blocked state", () => {
    const result = getStateBadgeClass("AIBlocked");
    expect(result).toContain("bg-state-blocked-bg");
    expect(result).toContain("text-state-blocked");
  });

  it("returns the done badge classes for a done state", () => {
    const result = getStateBadgeClass("Done");
    expect(result).toContain("bg-state-done-bg");
  });

  it("returns the idle badge classes for an unrecognized state", () => {
    const result = getStateBadgeClass("Unknown");
    expect(result).toContain("bg-state-idle-bg");
  });
});

describe("getStateDotClass", () => {
  it("returns the matching dot class for each category", () => {
    expect(getStateDotClass("Implementing")).toBe("bg-state-active");
    expect(getStateDotClass("AwaitingPlanApproval")).toBe("bg-state-waiting");
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
    expect(getStateDotClass("Done")).toBe("bg-state-done");
    expect(getStateDotClass("Todo")).toBe("bg-state-idle");
  });

  it("falls back to the idle dot class for an unrecognized state", () => {
    expect(getStateDotClass("Nonsense")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts spaces before each capital letter and trims the result", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state unchanged", () => {
    expect(formatStateName("Done")).toBe("Done");
  });

  it("handles an acronym-style state", () => {
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("returns an empty string for an empty input", () => {
    expect(formatStateName("")).toBe("");
  });
});
