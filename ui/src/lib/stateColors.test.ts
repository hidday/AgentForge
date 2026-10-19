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
    it(`maps "${state}" to "${category}"`, () => {
      expect(getStateCategory(state)).toBe(category);
    });
  }

  it("falls back to 'idle' for an unrecognized state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });

  it("falls back to 'idle' for an empty string", () => {
    expect(getStateCategory("")).toBe("idle");
  });
});

describe("getStateBadgeClass / getStateDotClass", () => {
  const CATEGORIES: StateCategory[] = ["active", "waiting", "blocked", "done", "idle"];
  const STATE_FOR_CATEGORY: Record<StateCategory, string> = {
    active: "Planning",
    waiting: "AwaitingPlanApproval",
    blocked: "AIBlocked",
    done: "Done",
    idle: "Todo",
  };

  for (const category of CATEGORIES) {
    const state = STATE_FOR_CATEGORY[category];
    it(`getStateBadgeClass includes the "${category}" badge classes for "${state}"`, () => {
      const cls = getStateBadgeClass(state);
      expect(cls).toContain(`state-${category}`);
      expect(cls).toContain("border-");
    });

    it(`getStateDotClass includes the "${category}" dot class for "${state}"`, () => {
      expect(getStateDotClass(state)).toBe(`bg-state-${category}`);
    });
  }

  it("badge and dot classes fall back to the idle category for unknown states", () => {
    expect(getStateBadgeClass("Nonsense")).toContain("state-idle");
    expect(getStateDotClass("Nonsense")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each internal capital letter", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word, single-capital state unchanged", () => {
    expect(formatStateName("Done")).toBe("Done");
  });

  it("handles consecutive capitals by spacing each one", () => {
    expect(formatStateName("AIReview")).toBe("A I Review");
  });

  it("returns an empty string unchanged", () => {
    expect(formatStateName("")).toBe("");
  });
});
