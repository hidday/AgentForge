import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
} from "./stateColors.ts";

describe("getStateCategory", () => {
  it("returns the mapped category for a known state", () => {
    expect(getStateCategory("Planning")).toBe("active");
    expect(getStateCategory("AwaitingPlanApproval")).toBe("waiting");
    expect(getStateCategory("AIBlocked")).toBe("blocked");
    expect(getStateCategory("Done")).toBe("done");
    expect(getStateCategory("Todo")).toBe("idle");
  });

  it("falls back to 'idle' for an unknown state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the badge class for the state's category", () => {
    expect(getStateBadgeClass("Planning")).toBe(
      "bg-state-active-bg text-state-active border-state-active/30",
    );
    expect(getStateBadgeClass("Done")).toBe(
      "bg-state-done-bg text-state-done border-state-done/30",
    );
  });

  it("falls back to the idle badge class for an unknown state", () => {
    expect(getStateBadgeClass("Bogus")).toBe(
      "bg-state-idle-bg text-state-idle border-state-idle/30",
    );
  });
});

describe("getStateDotClass", () => {
  it("returns the dot class for the state's category", () => {
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
    expect(getStateDotClass("ReadyForHumanReview")).toBe("bg-state-waiting");
  });

  it("falls back to the idle dot class for an unknown state", () => {
    expect(getStateDotClass("Bogus")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each capital letter and trims the leading space", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word, all-lowercase-after-first state unchanged aside from trimming", () => {
    expect(formatStateName("Done")).toBe("Done");
  });

  it("handles a state with many capitalized words", () => {
    expect(formatStateName("HumanClarificationNeeded")).toBe(
      "Human Clarification Needed",
    );
  });

  it("returns an empty string unchanged", () => {
    expect(formatStateName("")).toBe("");
  });
});
