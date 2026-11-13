import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
} from "./stateColors.ts";

describe("getStateCategory", () => {
  it("maps each known run state to its documented category", () => {
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

  it("falls back to 'idle' for an unrecognized state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the badge classes for the state's category", () => {
    expect(getStateBadgeClass("Done")).toContain("state-done");
    expect(getStateBadgeClass("AIBlocked")).toContain("state-blocked");
  });

  it("falls back to the idle badge classes for an unknown state", () => {
    expect(getStateBadgeClass("Bogus")).toBe(getStateBadgeClass("Todo"));
  });
});

describe("getStateDotClass", () => {
  it("returns the dot class for the state's category", () => {
    expect(getStateDotClass("Planning")).toBe("bg-state-active");
    expect(getStateDotClass("Done")).toBe("bg-state-done");
  });

  it("falls back to the idle dot class for an unknown state", () => {
    expect(getStateDotClass("Bogus")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts spaces before interior capital letters", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("leaves a single-word, all-lowercase-after-first state untouched", () => {
    expect(formatStateName("Todo")).toBe("Todo");
  });

  it("trims any resulting leading/trailing whitespace", () => {
    expect(formatStateName("Done")).toBe("Done");
  });
});
