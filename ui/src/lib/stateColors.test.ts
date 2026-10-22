import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
} from "./stateColors.ts";

describe("getStateCategory", () => {
  const cases: Array<[string, string]> = [
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

  it.each(cases)("maps %s to category %s", (state, expected) => {
    expect(getStateCategory(state)).toBe(expected);
  });

  it("falls back to 'idle' for an unknown state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns a badge class containing the category's state token for a known state", () => {
    expect(getStateBadgeClass("Done")).toContain("state-done");
  });

  it("returns the idle badge class for an unknown state", () => {
    expect(getStateBadgeClass("Bogus")).toContain("state-idle");
  });
});

describe("getStateDotClass", () => {
  it("returns a dot class containing the category's state token for a known state", () => {
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
  });

  it("returns the idle dot class for an unknown state", () => {
    expect(getStateDotClass("Bogus")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each interior capital letter", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state unchanged", () => {
    expect(formatStateName("Done")).toBe("Done");
  });

  it("trims any leading space produced by a leading capital, and splits consecutive capitals", () => {
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });
});
