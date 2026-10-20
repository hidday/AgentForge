import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
  type StateCategory,
} from "./stateColors";

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

describe("getStateCategory", () => {
  for (const [state, category] of Object.entries(KNOWN_STATES)) {
    it(`maps "${state}" to category "${category}"`, () => {
      expect(getStateCategory(state)).toBe(category);
    });
  }

  it("falls back to 'idle' for an unknown state", () => {
    expect(getStateCategory("SomethingMadeUp")).toBe("idle");
  });

  it("falls back to 'idle' for an empty string", () => {
    expect(getStateCategory("")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the active badge classes for an active state", () => {
    const result = getStateBadgeClass("Planning");
    expect(result).toContain("bg-state-active-bg");
    expect(result).toContain("text-state-active");
  });

  it("returns the waiting badge classes for a waiting state", () => {
    const result = getStateBadgeClass("AwaitingPlanApproval");
    expect(result).toContain("bg-state-waiting-bg");
  });

  it("returns the blocked badge classes for a blocked state", () => {
    const result = getStateBadgeClass("AIBlocked");
    expect(result).toContain("bg-state-blocked-bg");
  });

  it("returns the done badge classes for a done state", () => {
    const result = getStateBadgeClass("Done");
    expect(result).toContain("bg-state-done-bg");
  });

  it("returns the idle badge classes for an unknown state (default fallback)", () => {
    const result = getStateBadgeClass("NotARealState");
    expect(result).toContain("bg-state-idle-bg");
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

  it("returns the idle dot class for an unknown/default state", () => {
    expect(getStateDotClass("Bogus")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each internal capital letter", () => {
    expect(formatStateName("PlanReview")).toBe("Plan Review");
  });

  it("handles a single-word state unchanged", () => {
    expect(formatStateName("Done")).toBe("Done");
  });

  it("handles states with multiple capitalized words", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("handles acronym-like consecutive capitals by splitting each one", () => {
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("returns an empty string for empty input", () => {
    expect(formatStateName("")).toBe("");
  });

  it("trims a leading space when the state starts with a capital letter", () => {
    // "Todo" -> replace inserts a space before "T" at index 0, then trim removes it
    expect(formatStateName("Todo")).toBe("Todo");
  });
});
