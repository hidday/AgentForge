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

  it("returns the done badge classes for Done", () => {
    expect(getStateBadgeClass("Done")).toBe(
      "bg-state-done-bg text-state-done border-state-done/30",
    );
  });

  it("returns the blocked badge classes for AIBlocked", () => {
    expect(getStateBadgeClass("AIBlocked")).toBe(
      "bg-state-blocked-bg text-state-blocked border-state-blocked/30",
    );
  });

  it("returns the idle badge classes for an unknown state", () => {
    expect(getStateBadgeClass("Nonsense")).toBe(
      "bg-state-idle-bg text-state-idle border-state-idle/30",
    );
  });
});

describe("getStateDotClass", () => {
  it("returns the matching dot class per category", () => {
    expect(getStateDotClass("Implementing")).toBe("bg-state-active");
    expect(getStateDotClass("AwaitingPlanApproval")).toBe("bg-state-waiting");
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
    expect(getStateDotClass("Done")).toBe("bg-state-done");
    expect(getStateDotClass("Unknown")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each capital letter and trims the result", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
    expect(formatStateName("Done")).toBe("Done");
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("returns an empty string unchanged", () => {
    expect(formatStateName("")).toBe("");
  });

  it("leaves a fully lowercase string unchanged", () => {
    expect(formatStateName("already lower")).toBe("already lower");
  });
});
