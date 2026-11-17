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

  it.each(cases)("maps %s to %s", (state, expected) => {
    expect(getStateCategory(state)).toBe(expected);
  });

  it("falls back to 'idle' for an unknown state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the active badge classes for an active state", () => {
    expect(getStateBadgeClass("Implementing")).toContain("state-active");
  });

  it("returns the blocked badge classes for a blocked state", () => {
    expect(getStateBadgeClass("AIBlocked")).toContain("state-blocked");
  });

  it("returns the idle badge classes for an unrecognized state", () => {
    expect(getStateBadgeClass("Bogus")).toContain("state-idle");
  });
});

describe("getStateDotClass", () => {
  it("returns the done dot class for Done", () => {
    expect(getStateDotClass("Done")).toBe("bg-state-done");
  });

  it("returns the waiting dot class for a waiting state", () => {
    expect(getStateDotClass("ReadyForHumanReview")).toBe("bg-state-waiting");
  });

  it("returns the idle dot class for an unrecognized state", () => {
    expect(getStateDotClass("Bogus")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each internal capital letter", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state unchanged", () => {
    expect(formatStateName("Done")).toBe("Done");
  });

  it("inserts a space before every capital, including consecutive ones", () => {
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });
});
