import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
  type StateCategory,
} from "./stateColors.ts";

describe("getStateCategory", () => {
  const cases: Array<[string, StateCategory]> = [
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

  it("returns the waiting badge classes for a waiting state", () => {
    expect(getStateBadgeClass("ReadyForHumanReview")).toBe(
      "bg-state-waiting-bg text-state-waiting border-state-waiting/30",
    );
  });

  it("returns the blocked badge classes for a blocked state", () => {
    expect(getStateBadgeClass("AIBlocked")).toBe(
      "bg-state-blocked-bg text-state-blocked border-state-blocked/30",
    );
  });

  it("returns the done badge classes for a done state", () => {
    expect(getStateBadgeClass("Done")).toBe(
      "bg-state-done-bg text-state-done border-state-done/30",
    );
  });

  it("returns the idle badge classes for an unknown state", () => {
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
    expect(getStateDotClass("AwaitingPlanApproval")).toBe("bg-state-waiting");
  });

  it("returns the blocked dot class for a blocked state", () => {
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
  });

  it("returns the done dot class for a done state", () => {
    expect(getStateDotClass("Done")).toBe("bg-state-done");
  });

  it("returns the idle dot class for an unknown state", () => {
    expect(getStateDotClass("Todo")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each interior capital letter", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("trims a leading space produced by a leading capital", () => {
    expect(formatStateName("ReadyForHumanReview")).toBe("Ready For Human Review");
  });

  it("handles consecutive capitals (acronyms)", () => {
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("leaves a single-word state with no interior capitals unchanged", () => {
    expect(formatStateName("Todo")).toBe("Todo");
  });

  it("returns an empty string for an empty input", () => {
    expect(formatStateName("")).toBe("");
  });
});
