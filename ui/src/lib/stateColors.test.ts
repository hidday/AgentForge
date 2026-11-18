import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
} from "./stateColors";

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
  ] as const)("maps %s to %s", (state, expected) => {
    expect(getStateCategory(state)).toBe(expected);
  });

  it("falls back to 'idle' for an unknown state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the badge classes for the category of a known state", () => {
    expect(getStateBadgeClass("Done")).toContain("state-done");
  });

  it("falls back to the idle badge classes for an unknown state", () => {
    expect(getStateBadgeClass("Bogus")).toContain("state-idle");
  });

  it.each(["Planning", "AwaitingPlanApproval", "AIBlocked", "Done", "Todo"])(
    "returns a border/background/text class triple for %s",
    (state) => {
      const cls = getStateBadgeClass(state);
      expect(cls).toContain("bg-");
      expect(cls).toContain("text-");
      expect(cls).toContain("border-");
    },
  );
});

describe("getStateDotClass", () => {
  it("returns the dot class for a known state's category", () => {
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
  });

  it("falls back to the idle dot class for an unknown state", () => {
    expect(getStateDotClass("Bogus")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts spaces before capital letters in a PascalCase state", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state unchanged", () => {
    expect(formatStateName("Done")).toBe("Done");
  });

  it("trims any leading space produced by a leading capital", () => {
    expect(formatStateName("Todo")).toBe("Todo");
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });
});
