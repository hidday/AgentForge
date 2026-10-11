import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
  type StateCategory,
} from "./stateColors.ts";

const EXPECTED_CATEGORIES: Record<string, StateCategory> = {
  Todo: "idle",
  Planning: "active",
  PlanReview: "active",
  PlanRevision: "active",
  AwaitingPlanApproval: "waiting",
  Implementing: "active",
  AIReview: "active",
  AddressingReview: "active",
  ReadyForHumanReview: "waiting",
  Done: "done",
  AIBlocked: "blocked",
  HumanClarificationNeeded: "waiting",
};

describe("getStateCategory", () => {
  for (const [state, category] of Object.entries(EXPECTED_CATEGORIES)) {
    it(`maps ${state} to ${category}`, () => {
      expect(getStateCategory(state)).toBe(category);
    });
  }

  it("falls back to idle for an unrecognized state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the active badge classes", () => {
    const cls = getStateBadgeClass("Planning");
    expect(cls).toContain("bg-state-active-bg");
    expect(cls).toContain("text-state-active");
    expect(cls).toContain("border-state-active/30");
  });

  it("returns the waiting badge classes", () => {
    const cls = getStateBadgeClass("AwaitingPlanApproval");
    expect(cls).toContain("bg-state-waiting-bg");
    expect(cls).toContain("text-state-waiting");
  });

  it("returns the blocked badge classes", () => {
    const cls = getStateBadgeClass("AIBlocked");
    expect(cls).toContain("bg-state-blocked-bg");
    expect(cls).toContain("text-state-blocked");
  });

  it("returns the done badge classes", () => {
    const cls = getStateBadgeClass("Done");
    expect(cls).toContain("bg-state-done-bg");
    expect(cls).toContain("text-state-done");
  });

  it("returns the idle badge classes for Todo and for unknown states", () => {
    expect(getStateBadgeClass("Todo")).toContain("bg-state-idle-bg");
    expect(getStateBadgeClass("NotARealState")).toContain("bg-state-idle-bg");
  });
});

describe("getStateDotClass", () => {
  it("returns the matching dot class for each category", () => {
    expect(getStateDotClass("Planning")).toBe("bg-state-active");
    expect(getStateDotClass("AwaitingPlanApproval")).toBe("bg-state-waiting");
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
    expect(getStateDotClass("Done")).toBe("bg-state-done");
    expect(getStateDotClass("Todo")).toBe("bg-state-idle");
    expect(getStateDotClass("Unknown")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each capital letter in a PascalCase state", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state unchanged", () => {
    expect(formatStateName("Todo")).toBe("Todo");
  });

  it("handles consecutive capitals", () => {
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("handles an already-lowercase/empty-ish input without throwing", () => {
    expect(formatStateName("")).toBe("");
  });
});
