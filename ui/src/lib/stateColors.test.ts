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

  it("is case sensitive (lowercase variant is unknown)", () => {
    expect(getStateCategory("done")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the active badge classes", () => {
    expect(getStateBadgeClass("Planning")).toBe(
      "bg-state-active-bg text-state-active border-state-active/30",
    );
  });

  it("returns the waiting badge classes", () => {
    expect(getStateBadgeClass("AwaitingPlanApproval")).toBe(
      "bg-state-waiting-bg text-state-waiting border-state-waiting/30",
    );
  });

  it("returns the blocked badge classes", () => {
    expect(getStateBadgeClass("AIBlocked")).toBe(
      "bg-state-blocked-bg text-state-blocked border-state-blocked/30",
    );
  });

  it("returns the done badge classes", () => {
    expect(getStateBadgeClass("Done")).toBe(
      "bg-state-done-bg text-state-done border-state-done/30",
    );
  });

  it("returns the idle badge classes for an unknown state", () => {
    expect(getStateBadgeClass("Bogus")).toBe(
      "bg-state-idle-bg text-state-idle border-state-idle/30",
    );
  });
});

describe("getStateDotClass", () => {
  it("returns the active dot class", () => {
    expect(getStateDotClass("Implementing")).toBe("bg-state-active");
  });

  it("returns the waiting dot class", () => {
    expect(getStateDotClass("ReadyForHumanReview")).toBe("bg-state-waiting");
  });

  it("returns the blocked dot class", () => {
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
  });

  it("returns the done dot class", () => {
    expect(getStateDotClass("Done")).toBe("bg-state-done");
  });

  it("returns the idle dot class for an unknown state", () => {
    expect(getStateDotClass("")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("returns the name unchanged when it is a single word", () => {
    expect(formatStateName("Todo")).toBe("Todo");
  });

  it("inserts spaces before internal capitals for a two-word name", () => {
    expect(formatStateName("PlanReview")).toBe("Plan Review");
  });

  it("inserts spaces for every capital, including adjacent ones", () => {
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("handles a name with three capitalized words", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("returns an empty string unchanged", () => {
    expect(formatStateName("")).toBe("");
  });

  it("trims any leading space produced by a leading capital", () => {
    const result = formatStateName("HumanClarificationNeeded");
    expect(result).toBe("Human Clarification Needed");
    expect(result.startsWith(" ")).toBe(false);
  });
});
