import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
} from "./stateColors.ts";

describe("getStateCategory", () => {
  it("maps known states to their documented category", () => {
    expect(getStateCategory("Todo")).toBe("idle");
    expect(getStateCategory("Planning")).toBe("active");
    expect(getStateCategory("PlanReview")).toBe("active");
    expect(getStateCategory("PlanRevision")).toBe("active");
    expect(getStateCategory("AwaitingPlanApproval")).toBe("waiting");
    expect(getStateCategory("Implementing")).toBe("active");
    expect(getStateCategory("AIReview")).toBe("active");
    expect(getStateCategory("AddressingReview")).toBe("active");
    expect(getStateCategory("ReadyForHumanReview")).toBe("waiting");
    expect(getStateCategory("Done")).toBe("done");
    expect(getStateCategory("AIBlocked")).toBe("blocked");
    expect(getStateCategory("HumanClarificationNeeded")).toBe("waiting");
  });

  it("falls back to 'idle' for unknown states", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
    expect(getStateCategory("")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the badge classes for the state's category", () => {
    expect(getStateBadgeClass("Done")).toContain("state-done");
    expect(getStateBadgeClass("AIBlocked")).toContain("state-blocked");
  });

  it("falls back to idle badge classes for unknown states", () => {
    expect(getStateBadgeClass("Nonsense")).toContain("state-idle");
  });
});

describe("getStateDotClass", () => {
  it("returns the dot class for the state's category", () => {
    expect(getStateDotClass("Planning")).toBe("bg-state-active");
    expect(getStateDotClass("ReadyForHumanReview")).toBe("bg-state-waiting");
  });

  it("falls back to idle dot class for unknown states", () => {
    expect(getStateDotClass("Nonsense")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts spaces before interior capital letters", () => {
    expect(formatStateName("PlanReview")).toBe("Plan Review");
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state unchanged", () => {
    expect(formatStateName("Todo")).toBe("Todo");
    expect(formatStateName("Done")).toBe("Done");
  });

  it("trims surrounding whitespace", () => {
    expect(formatStateName("Todo")).not.toMatch(/^\s|\s$/);
  });
});
