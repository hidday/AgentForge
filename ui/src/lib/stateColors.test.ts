import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
  type StateCategory,
} from "./stateColors";

const KNOWN_STATE_CATEGORIES: Record<string, StateCategory> = {
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
  for (const [state, category] of Object.entries(KNOWN_STATE_CATEGORIES)) {
    it(`maps "${state}" to "${category}"`, () => {
      expect(getStateCategory(state)).toBe(category);
    });
  }

  it("falls back to 'idle' for an unknown state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });

  it("falls back to 'idle' for an empty string", () => {
    expect(getStateCategory("")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  const ALL_CATEGORIES: StateCategory[] = ["active", "waiting", "blocked", "done", "idle"];

  it("returns a defined, non-empty class string for every category", () => {
    // Drive every category via a representative state for each.
    const representative: Record<StateCategory, string> = {
      active: "Planning",
      waiting: "AwaitingPlanApproval",
      blocked: "AIBlocked",
      done: "Done",
      idle: "Todo",
    };
    for (const category of ALL_CATEGORIES) {
      const cls = getStateBadgeClass(representative[category]);
      expect(typeof cls).toBe("string");
      expect(cls.length).toBeGreaterThan(0);
    }
  });

  it("returns the active badge classes for an active state", () => {
    expect(getStateBadgeClass("Planning")).toBe(
      "bg-state-active-bg text-state-active border-state-active/30",
    );
  });

  it("returns the blocked badge classes for a blocked state", () => {
    expect(getStateBadgeClass("AIBlocked")).toBe(
      "bg-state-blocked-bg text-state-blocked border-state-blocked/30",
    );
  });

  it("returns the idle badge classes for an unknown state", () => {
    expect(getStateBadgeClass("Nonsense")).toBe(
      "bg-state-idle-bg text-state-idle border-state-idle/30",
    );
  });
});

describe("getStateDotClass", () => {
  it("returns the matching dot class for each known category", () => {
    expect(getStateDotClass("Planning")).toBe("bg-state-active");
    expect(getStateDotClass("AwaitingPlanApproval")).toBe("bg-state-waiting");
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
    expect(getStateDotClass("Done")).toBe("bg-state-done");
    expect(getStateDotClass("Todo")).toBe("bg-state-idle");
  });

  it("falls back to the idle dot class for an unknown state", () => {
    expect(getStateDotClass("Nonsense")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each interior capital letter", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state unchanged", () => {
    expect(formatStateName("Done")).toBe("Done");
  });

  it("handles a state with consecutive capitals", () => {
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("trims any resulting leading/trailing whitespace", () => {
    expect(formatStateName("Todo")).toBe("Todo");
  });
});
