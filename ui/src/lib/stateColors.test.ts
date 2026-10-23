import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
  type StateCategory,
} from "./stateColors.ts";

describe("getStateCategory", () => {
  it.each<[string, StateCategory]>([
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

  it("falls back to 'idle' for an unknown state", () => {
    expect(getStateCategory("SomeMadeUpState")).toBe("idle");
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

  it("returns the blocked badge classes for AIBlocked", () => {
    const cls = getStateBadgeClass("AIBlocked");
    expect(cls).toContain("state-blocked");
  });

  it("returns the done badge classes for Done", () => {
    const cls = getStateBadgeClass("Done");
    expect(cls).toContain("state-done");
  });

  it("falls back to idle badge classes for an unrecognized state", () => {
    const cls = getStateBadgeClass("Unknown");
    expect(cls).toContain("state-idle");
  });
});

describe("getStateDotClass", () => {
  it("returns the waiting dot class for a waiting state", () => {
    expect(getStateDotClass("ReadyForHumanReview")).toBe("bg-state-waiting");
  });

  it("returns the idle dot class for an unrecognized state", () => {
    expect(getStateDotClass("Unknown")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each interior capital letter", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state untouched aside from trimming", () => {
    expect(formatStateName("Done")).toBe("Done");
  });

  it("handles a fully lowercase string with no capitals", () => {
    expect(formatStateName("done")).toBe("done");
  });

  it("handles an empty string", () => {
    expect(formatStateName("")).toBe("");
  });
});
