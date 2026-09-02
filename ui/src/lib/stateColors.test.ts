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
    expect(getStateBadgeClass("Implementing")).toBe(
      "bg-state-active-bg text-state-active border-state-active/30",
    );
  });

  it("returns the done badge classes for the Done state", () => {
    expect(getStateBadgeClass("Done")).toBe("bg-state-done-bg text-state-done border-state-done/30");
  });

  it("returns the blocked badge classes for AIBlocked", () => {
    expect(getStateBadgeClass("AIBlocked")).toBe(
      "bg-state-blocked-bg text-state-blocked border-state-blocked/30",
    );
  });

  it("falls back to idle badge classes for an unknown state", () => {
    expect(getStateBadgeClass("Nonsense")).toBe(
      "bg-state-idle-bg text-state-idle border-state-idle/30",
    );
  });
});

describe("getStateDotClass", () => {
  it("returns the active dot class for an active state", () => {
    expect(getStateDotClass("Planning")).toBe("bg-state-active");
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

  it("leaves a single-word state name unchanged", () => {
    expect(formatStateName("Done")).toBe("Done");
  });

  it("handles a state name with consecutive capitals", () => {
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("returns an empty string for an empty input", () => {
    expect(formatStateName("")).toBe("");
  });
});
