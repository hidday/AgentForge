import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
  type StateCategory,
} from "./stateColors.ts";

// The full set of known RunState values mapped to their expected category,
// mirroring the STATE_CATEGORIES table in stateColors.ts.
const KNOWN_STATES: Record<string, StateCategory> = {
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

const CATEGORY_CLASSES: Record<StateCategory, { badge: string; dot: string }> = {
  active: {
    badge: "bg-state-active-bg text-state-active border-state-active/30",
    dot: "bg-state-active",
  },
  waiting: {
    badge: "bg-state-waiting-bg text-state-waiting border-state-waiting/30",
    dot: "bg-state-waiting",
  },
  blocked: {
    badge: "bg-state-blocked-bg text-state-blocked border-state-blocked/30",
    dot: "bg-state-blocked",
  },
  done: {
    badge: "bg-state-done-bg text-state-done border-state-done/30",
    dot: "bg-state-done",
  },
  idle: {
    badge: "bg-state-idle-bg text-state-idle border-state-idle/30",
    dot: "bg-state-idle",
  },
};

describe("getStateCategory", () => {
  for (const [state, category] of Object.entries(KNOWN_STATES)) {
    it(`maps "${state}" to category "${category}"`, () => {
      expect(getStateCategory(state)).toBe(category);
    });
  }

  it("falls back to 'idle' for an unknown state value", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });

  it("falls back to 'idle' for an empty string", () => {
    expect(getStateCategory("")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  for (const [state, category] of Object.entries(KNOWN_STATES)) {
    it(`returns the "${category}" badge classes for "${state}"`, () => {
      expect(getStateBadgeClass(state)).toBe(CATEGORY_CLASSES[category].badge);
    });
  }

  it("falls back to the 'idle' badge classes for an unknown state", () => {
    expect(getStateBadgeClass("NotARealState")).toBe(CATEGORY_CLASSES.idle.badge);
  });
});

describe("getStateDotClass", () => {
  for (const [state, category] of Object.entries(KNOWN_STATES)) {
    it(`returns the "${category}" dot class for "${state}"`, () => {
      expect(getStateDotClass(state)).toBe(CATEGORY_CLASSES[category].dot);
    });
  }

  it("falls back to the 'idle' dot class for an unknown state", () => {
    expect(getStateDotClass("NotARealState")).toBe(CATEGORY_CLASSES.idle.dot);
  });
});

describe("formatStateName", () => {
  it("inserts a space before each interior capital letter", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word capitalized state unchanged (no interior capitals)", () => {
    expect(formatStateName("Todo")).toBe("Todo");
    expect(formatStateName("Done")).toBe("Done");
  });

  it("handles consecutive capitals (acronym-like) by splitting each one", () => {
    expect(formatStateName("AIReview")).toBe("A I Review");
  });

  it("trims any resulting leading/trailing whitespace", () => {
    // formatStateName should never leave stray whitespace at the ends
    const result = formatStateName("Todo");
    expect(result).toBe(result.trim());
  });

  it("handles an empty string", () => {
    expect(formatStateName("")).toBe("");
  });
});
