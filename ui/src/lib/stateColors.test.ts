import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
  type StateCategory,
} from "./stateColors.ts";

describe("getStateCategory", () => {
  const expected: Record<string, StateCategory> = {
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

  for (const [state, category] of Object.entries(expected)) {
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

  it("is case-sensitive and falls back to 'idle' for a near-miss casing", () => {
    expect(getStateCategory("todo")).toBe("idle");
    expect(getStateCategory("DONE")).toBe("idle");
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
    const cls = getStateBadgeClass("AwaitingPlanApproval");
    expect(cls).toContain("bg-state-waiting-bg");
    expect(cls).toContain("text-state-waiting");
    expect(cls).toContain("border-state-waiting/30");
  });

  it("returns the blocked badge classes for a blocked state", () => {
    const cls = getStateBadgeClass("AIBlocked");
    expect(cls).toContain("bg-state-blocked-bg");
    expect(cls).toContain("text-state-blocked");
    expect(cls).toContain("border-state-blocked/30");
  });

  it("returns the done badge classes for a done state", () => {
    const cls = getStateBadgeClass("Done");
    expect(cls).toContain("bg-state-done-bg");
    expect(cls).toContain("text-state-done");
    expect(cls).toContain("border-state-done/30");
  });

  it("returns the idle badge classes for an unknown state (fallback)", () => {
    const cls = getStateBadgeClass("NotARealState");
    expect(cls).toContain("bg-state-idle-bg");
    expect(cls).toContain("text-state-idle");
    expect(cls).toContain("border-state-idle/30");
  });
});

describe("getStateDotClass", () => {
  it("returns the matching dot class for each category", () => {
    expect(getStateDotClass("Planning")).toBe("bg-state-active");
    expect(getStateDotClass("AwaitingPlanApproval")).toBe("bg-state-waiting");
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
    expect(getStateDotClass("Done")).toBe("bg-state-done");
  });

  it("falls back to the idle dot class for an unknown state", () => {
    expect(getStateDotClass("Bogus")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each interior capital letter", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("formats a simple single-word state unchanged (no interior capitals)", () => {
    expect(formatStateName("Todo")).toBe("Todo");
  });

  it("formats an all-caps acronym by splitting every capital letter", () => {
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("formats HumanClarificationNeeded correctly", () => {
    expect(formatStateName("HumanClarificationNeeded")).toBe(
      "Human Clarification Needed",
    );
  });

  it("trims any leading/trailing whitespace produced by the replacement", () => {
    // formatStateName should never leave a leading space even if the state
    // itself starts with a capital letter (the very first char is never
    // preceded by a space because of how the regex inserts only before
    // subsequent capitals, but we assert trim() behavior defensively).
    const result = formatStateName("Done");
    expect(result).toBe(result.trim());
    expect(result.startsWith(" ")).toBe(false);
    expect(result.endsWith(" ")).toBe(false);
  });

  it("returns an empty string unchanged", () => {
    expect(formatStateName("")).toBe("");
  });
});
