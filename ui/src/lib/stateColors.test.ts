import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
} from "./stateColors.ts";

describe("getStateCategory", () => {
  it("maps each known state to its documented category", () => {
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

  it("falls back to 'idle' for an empty string", () => {
    expect(getStateCategory("")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the active badge classes for an active state", () => {
    expect(getStateBadgeClass("Implementing")).toContain("state-active");
  });

  it("returns the done badge classes for the Done state", () => {
    expect(getStateBadgeClass("Done")).toContain("state-done");
  });

  it("returns the idle badge classes for an unrecognized state", () => {
    expect(getStateBadgeClass("Bogus")).toContain("state-idle");
  });
});

describe("getStateDotClass", () => {
  it("returns the blocked dot class for AIBlocked", () => {
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
  });

  it("returns the waiting dot class for ReadyForHumanReview", () => {
    expect(getStateDotClass("ReadyForHumanReview")).toBe("bg-state-waiting");
  });

  it("returns the idle dot class for an unrecognized state", () => {
    expect(getStateDotClass("Bogus")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts spaces before internal capital letters", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state untouched", () => {
    expect(formatStateName("Done")).toBe("Done");
  });

  it("handles an all-caps acronym by spacing every capital", () => {
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("returns an empty string unchanged", () => {
    expect(formatStateName("")).toBe("");
  });
});
