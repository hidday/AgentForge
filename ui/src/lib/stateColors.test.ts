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
    expect(getStateCategory("")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the badge classes matching the state's category", () => {
    expect(getStateBadgeClass("Planning")).toContain("bg-state-active-bg");
    expect(getStateBadgeClass("AwaitingPlanApproval")).toContain("bg-state-waiting-bg");
    expect(getStateBadgeClass("AIBlocked")).toContain("bg-state-blocked-bg");
    expect(getStateBadgeClass("Done")).toContain("bg-state-done-bg");
    expect(getStateBadgeClass("Unknown")).toContain("bg-state-idle-bg");
  });
});

describe("getStateDotClass", () => {
  it("returns the dot class matching the state's category", () => {
    expect(getStateDotClass("Planning")).toBe("bg-state-active");
    expect(getStateDotClass("Done")).toBe("bg-state-done");
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
    expect(getStateDotClass("ReadyForHumanReview")).toBe("bg-state-waiting");
    expect(getStateDotClass("Unknown")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts spaces before internal capital letters", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("leaves single-word states unchanged", () => {
    expect(formatStateName("Todo")).toBe("Todo");
    expect(formatStateName("Done")).toBe("Done");
  });

  it("trims leading/trailing whitespace produced by the replace", () => {
    expect(formatStateName("Done")).not.toMatch(/^\s|\s$/);
  });
});
