import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
  type StateCategory,
} from "./stateColors.ts";

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
  it.each(Object.entries(KNOWN_STATES))("maps %s to category %s", (state, expected) => {
    expect(getStateCategory(state)).toBe(expected);
  });

  it("falls back to 'idle' for an unrecognized state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });

  it("falls back to 'idle' for an empty string", () => {
    expect(getStateCategory("")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the active badge classes for an active state", () => {
    const cls = getStateBadgeClass("Implementing");
    expect(cls).toContain("state-active");
  });

  it("returns the waiting badge classes for a waiting state", () => {
    expect(getStateBadgeClass("ReadyForHumanReview")).toContain("state-waiting");
  });

  it("returns the blocked badge classes for a blocked state", () => {
    expect(getStateBadgeClass("AIBlocked")).toContain("state-blocked");
  });

  it("returns the done badge classes for a done state", () => {
    expect(getStateBadgeClass("Done")).toContain("state-done");
  });

  it("returns the idle badge classes for an unknown state", () => {
    expect(getStateBadgeClass("Bogus")).toContain("state-idle");
  });
});

describe("getStateDotClass", () => {
  it("returns the matching dot class for each known category", () => {
    expect(getStateDotClass("Implementing")).toBe("bg-state-active");
    expect(getStateDotClass("ReadyForHumanReview")).toBe("bg-state-waiting");
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
    expect(getStateDotClass("Done")).toBe("bg-state-done");
    expect(getStateDotClass("Bogus")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each interior capital letter", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state unchanged", () => {
    expect(formatStateName("Done")).toBe("Done");
  });

  it("handles consecutive capitals (acronym-like) by spacing each one", () => {
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("trims any resulting leading/trailing whitespace", () => {
    expect(formatStateName("Todo")).toBe("Todo");
  });
});
