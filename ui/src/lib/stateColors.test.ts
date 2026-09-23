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

  it("falls back to 'idle' for an unrecognized state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });

  it("falls back to 'idle' for an empty string", () => {
    expect(getStateCategory("")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the active badge classes for an active state", () => {
    const cls = getStateBadgeClass("Planning");
    expect(cls).toContain("state-active");
  });

  it("returns the waiting badge classes for a waiting state", () => {
    expect(getStateBadgeClass("AwaitingPlanApproval")).toContain("state-waiting");
  });

  it("returns the blocked badge classes for a blocked state", () => {
    expect(getStateBadgeClass("AIBlocked")).toContain("state-blocked");
  });

  it("returns the done badge classes for a done state", () => {
    expect(getStateBadgeClass("Done")).toContain("state-done");
  });

  it("returns the idle badge classes for an unknown state", () => {
    expect(getStateBadgeClass("Unknown")).toContain("state-idle");
  });
});

describe("getStateDotClass", () => {
  it("returns the active dot class for an active state", () => {
    expect(getStateDotClass("Implementing")).toBe("bg-state-active");
  });

  it("returns the waiting dot class for a waiting state", () => {
    expect(getStateDotClass("ReadyForHumanReview")).toBe("bg-state-waiting");
  });

  it("returns the blocked dot class for a blocked state", () => {
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
  });

  it("returns the done dot class for a done state", () => {
    expect(getStateDotClass("Done")).toBe("bg-state-done");
  });

  it("returns the idle dot class for an unknown state", () => {
    expect(getStateDotClass("Whatever")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts spaces before capital letters", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state untouched aside from trimming", () => {
    expect(formatStateName("Done")).toBe("Done");
  });

  it("handles a fully lowercase string with no capitals", () => {
    expect(formatStateName("todo")).toBe("todo");
  });

  it("trims a leading space produced by a leading capital", () => {
    // formatStateName inserts a space before every capital, then trims,
    // so a string starting with a capital shouldn't have a leading space.
    expect(formatStateName("AIBlocked")).toBe("AIBlocked".replace(/([A-Z])/g, " $1").trim());
    expect(formatStateName("AIBlocked").startsWith(" ")).toBe(false);
  });
});
