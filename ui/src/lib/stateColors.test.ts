import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
} from "./stateColors.ts";

describe("getStateCategory", () => {
  it("maps every known workflow state to its documented category", () => {
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
    expect(getStateCategory("SomeMadeUpState")).toBe("idle");
    expect(getStateCategory("")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the active badge classes for an active state", () => {
    const cls = getStateBadgeClass("Implementing");
    expect(cls).toContain("bg-state-active-bg");
    expect(cls).toContain("text-state-active");
    expect(cls).toContain("border-state-active/30");
  });

  it("returns the waiting badge classes for a waiting state", () => {
    const cls = getStateBadgeClass("AwaitingPlanApproval");
    expect(cls).toContain("bg-state-waiting-bg");
  });

  it("returns the blocked badge classes for a blocked state", () => {
    const cls = getStateBadgeClass("AIBlocked");
    expect(cls).toContain("bg-state-blocked-bg");
  });

  it("returns the done badge classes for the done state", () => {
    const cls = getStateBadgeClass("Done");
    expect(cls).toContain("bg-state-done-bg");
  });

  it("returns the idle badge classes for an unknown state", () => {
    const cls = getStateBadgeClass("Unknown");
    expect(cls).toContain("bg-state-idle-bg");
  });
});

describe("getStateDotClass", () => {
  it("returns the matching dot class for each category", () => {
    expect(getStateDotClass("Implementing")).toBe("bg-state-active");
    expect(getStateDotClass("AwaitingPlanApproval")).toBe("bg-state-waiting");
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
    expect(getStateDotClass("Done")).toBe("bg-state-done");
    expect(getStateDotClass("Unknown")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each capitalized word boundary", () => {
    expect(formatStateName("Todo")).toBe("Todo");
    expect(formatStateName("PlanReview")).toBe("Plan Review");
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
    expect(formatStateName("ReadyForHumanReview")).toBe("Ready For Human Review");
  });

  it("splits out consecutive uppercase letters (e.g. acronyms) individually", () => {
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
    expect(formatStateName("AIReview")).toBe("A I Review");
  });

  it("trims any leading space produced by a leading capital letter", () => {
    expect(formatStateName("Done")).toBe("Done");
    expect(formatStateName("Done").startsWith(" ")).toBe(false);
  });
});
