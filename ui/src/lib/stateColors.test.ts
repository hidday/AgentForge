import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
} from "./stateColors.ts";

describe("getStateCategory", () => {
  it("maps every known state to its documented category", () => {
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

  it("falls back to 'idle' for an unmapped state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });

  it("falls back to 'idle' for an empty string", () => {
    expect(getStateCategory("")).toBe("idle");
  });

  it("is case-sensitive: a differently-cased known key is unmapped", () => {
    expect(getStateCategory("todo")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the badge classes for each category", () => {
    expect(getStateBadgeClass("Planning")).toBe(
      "bg-state-active-bg text-state-active border-state-active/30",
    );
    expect(getStateBadgeClass("AwaitingPlanApproval")).toBe(
      "bg-state-waiting-bg text-state-waiting border-state-waiting/30",
    );
    expect(getStateBadgeClass("AIBlocked")).toBe(
      "bg-state-blocked-bg text-state-blocked border-state-blocked/30",
    );
    expect(getStateBadgeClass("Done")).toBe(
      "bg-state-done-bg text-state-done border-state-done/30",
    );
    expect(getStateBadgeClass("Todo")).toBe(
      "bg-state-idle-bg text-state-idle border-state-idle/30",
    );
  });

  it("falls back to the idle badge for an unknown state", () => {
    expect(getStateBadgeClass("Bogus")).toBe(
      "bg-state-idle-bg text-state-idle border-state-idle/30",
    );
  });
});

describe("getStateDotClass", () => {
  it("returns the dot classes for each category", () => {
    expect(getStateDotClass("Planning")).toBe("bg-state-active");
    expect(getStateDotClass("AwaitingPlanApproval")).toBe("bg-state-waiting");
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
    expect(getStateDotClass("Done")).toBe("bg-state-done");
    expect(getStateDotClass("Todo")).toBe("bg-state-idle");
  });

  it("falls back to the idle dot for an unknown state", () => {
    expect(getStateDotClass("Bogus")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each internal capital letter", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word, already-lowercase-following state as-is aside from spacing", () => {
    expect(formatStateName("Todo")).toBe("Todo");
  });

  it("handles consecutive capitals without collapsing them", () => {
    expect(formatStateName("AIReview")).toBe("A I Review");
  });

  it("returns an empty string for empty input", () => {
    expect(formatStateName("")).toBe("");
  });

  it("trims a leading capital's inserted space", () => {
    // The leading character is itself a capital, so replace() would prepend
    // a space; trim() must remove it.
    expect(formatStateName("Done")).toBe("Done");
  });
});
