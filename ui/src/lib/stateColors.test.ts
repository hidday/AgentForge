import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
  type StateCategory,
} from "./stateColors";

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

  it.each(cases)("maps %s to %s", (state, category) => {
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
    const cls = getStateBadgeClass("Planning");
    expect(cls).toContain("bg-state-active-bg");
    expect(cls).toContain("text-state-active");
    expect(cls).toContain("border-state-active/30");
  });

  it("returns the waiting badge classes for a waiting state", () => {
    expect(getStateBadgeClass("AwaitingPlanApproval")).toContain("bg-state-waiting-bg");
  });

  it("returns the blocked badge classes for a blocked state", () => {
    expect(getStateBadgeClass("AIBlocked")).toContain("bg-state-blocked-bg");
  });

  it("returns the done badge classes for a done state", () => {
    expect(getStateBadgeClass("Done")).toContain("bg-state-done-bg");
  });

  it("returns the idle badge classes for an unrecognized state", () => {
    expect(getStateBadgeClass("Nonsense")).toContain("bg-state-idle-bg");
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

  it("returns the idle dot class for an unrecognized state", () => {
    expect(getStateDotClass("Whatever")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each interior capital letter", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state unchanged", () => {
    expect(formatStateName("Todo")).toBe("Todo");
  });

  it("handles a state made entirely of one capitalized word", () => {
    expect(formatStateName("Done")).toBe("Done");
  });

  it("handles consecutive capitals like AIReview", () => {
    expect(formatStateName("AIReview")).toBe("A I Review");
  });

  it("trims and produces no leading space", () => {
    const result = formatStateName("HumanClarificationNeeded");
    expect(result.startsWith(" ")).toBe(false);
    expect(result).toBe("Human Clarification Needed");
  });
});
