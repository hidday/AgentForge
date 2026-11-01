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
    expect(cls).toContain("state-active");
  });

  it("returns the done badge classes for Done", () => {
    expect(getStateBadgeClass("Done")).toContain("state-done");
  });

  it("returns the idle badge classes for an unmapped state", () => {
    expect(getStateBadgeClass("Bogus")).toContain("state-idle");
  });
});

describe("getStateDotClass", () => {
  it("returns the blocked dot class for AIBlocked", () => {
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
  });

  it("returns the waiting dot class for a waiting state", () => {
    expect(getStateDotClass("ReadyForHumanReview")).toBe("bg-state-waiting");
  });

  it("returns the idle dot class for an unmapped state", () => {
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

  it("trims any leading space produced by a leading capital", () => {
    expect(formatStateName("Todo")).toBe("Todo");
  });

  it("returns an empty string unchanged", () => {
    expect(formatStateName("")).toBe("");
  });
});
