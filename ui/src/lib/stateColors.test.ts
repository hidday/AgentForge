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

  it("falls back to idle for unknown states", () => {
    expect(getStateCategory("Bogus")).toBe("idle");
    expect(getStateCategory("")).toBe("idle");
  });
});

describe("getStateBadgeClass / getStateDotClass", () => {
  it.each([
    ["Planning", "active"],
    ["AwaitingPlanApproval", "waiting"],
    ["AIBlocked", "blocked"],
    ["Done", "done"],
    ["Todo", "idle"],
    ["Unknown", "idle"],
  ])("uses %s -> %s category colors", (state, category) => {
    const badge = getStateBadgeClass(state);
    expect(badge).toContain(`bg-state-${category}-bg`);
    expect(badge).toContain(`text-state-${category}`);
    expect(badge).toContain(`border-state-${category}/30`);
    expect(getStateDotClass(state)).toBe(`bg-state-${category}`);
  });
});

describe("formatStateName", () => {
  it("splits PascalCase into words", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
    expect(formatStateName("Done")).toBe("Done");
  });

  it("splits each capital letter in acronyms", () => {
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("leaves lowercase strings untouched", () => {
    expect(formatStateName("todo")).toBe("todo");
  });
});
