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

  it("falls back to 'idle' for an unknown state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the badge classes for the category of a known state", () => {
    expect(getStateBadgeClass("Done")).toContain("bg-state-done-bg");
    expect(getStateBadgeClass("Done")).toContain("text-state-done");
  });

  it("falls back to idle badge classes for an unknown state", () => {
    expect(getStateBadgeClass("Bogus")).toContain("bg-state-idle-bg");
  });
});

describe("getStateDotClass", () => {
  it("returns the dot class for the category of a known state", () => {
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
  });

  it("falls back to idle dot class for an unknown state", () => {
    expect(getStateDotClass("Bogus")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each internal capital letter", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state unchanged", () => {
    expect(formatStateName("Todo")).toBe("Todo");
  });

  it("inserts a space before every capital, including consecutive ones", () => {
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("trims a leading space when the state itself starts with a capital", () => {
    // The leading capital would otherwise produce a leading space; trim() removes it.
    expect(formatStateName("Todo").startsWith(" ")).toBe(false);
  });
});
