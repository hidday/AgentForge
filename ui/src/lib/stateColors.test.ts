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

  it("falls back to idle for an unknown state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });

  it("falls back to idle for an empty string", () => {
    expect(getStateCategory("")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the active badge classes for an active state", () => {
    const cls = getStateBadgeClass("Planning");
    expect(cls).toContain("bg-state-active-bg");
    expect(cls).toContain("text-state-active");
  });

  it("returns the done badge classes for a done state", () => {
    const cls = getStateBadgeClass("Done");
    expect(cls).toContain("bg-state-done-bg");
  });

  it("returns the blocked badge classes for a blocked state", () => {
    const cls = getStateBadgeClass("AIBlocked");
    expect(cls).toContain("bg-state-blocked-bg");
  });

  it("falls back to idle classes for an unrecognized state", () => {
    expect(getStateBadgeClass("Nonsense")).toBe(getStateBadgeClass("Todo"));
  });
});

describe("getStateDotClass", () => {
  it("returns the matching dot class for each category", () => {
    expect(getStateDotClass("Planning")).toBe("bg-state-active");
    expect(getStateDotClass("AwaitingPlanApproval")).toBe("bg-state-waiting");
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
    expect(getStateDotClass("Done")).toBe("bg-state-done");
    expect(getStateDotClass("Todo")).toBe("bg-state-idle");
  });

  it("falls back to the idle dot class for an unknown state", () => {
    expect(getStateDotClass("Unknown")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each internal capital letter", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state unchanged (aside from trimming)", () => {
    expect(formatStateName("Todo")).toBe("Todo");
    expect(formatStateName("Done")).toBe("Done");
  });

  it("inserts a space between each letter of a leading acronym, since every capital is matched independently", () => {
    // The implementation regex matches every capital letter individually, so
    // adjacent capitals (e.g. the "AI" in AIReview) each get their own
    // leading space rather than being treated as one acronym unit.
    expect(formatStateName("AIReview")).toBe("A I Review");
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("returns an empty string for an empty input", () => {
    expect(formatStateName("")).toBe("");
  });
});
