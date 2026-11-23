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
    expect(getStateCategory("AwaitingPlanApproval")).toBe("waiting");
    expect(getStateCategory("Done")).toBe("done");
    expect(getStateCategory("AIBlocked")).toBe("blocked");
  });

  it("falls back to 'idle' for an unknown state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
    expect(getStateCategory("")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the badge classes matching the state's category", () => {
    expect(getStateBadgeClass("Done")).toContain("state-done");
    expect(getStateBadgeClass("AIBlocked")).toContain("state-blocked");
    expect(getStateBadgeClass("UnknownState")).toContain("state-idle");
  });
});

describe("getStateDotClass", () => {
  it("returns the dot class matching the state's category", () => {
    expect(getStateDotClass("Implementing")).toBe("bg-state-active");
    expect(getStateDotClass("ReadyForHumanReview")).toBe("bg-state-waiting");
    expect(getStateDotClass("UnknownState")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each interior capital letter", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("leaves a single-word state unchanged", () => {
    expect(formatStateName("Done")).toBe("Done");
  });

  it("trims any resulting leading/trailing whitespace", () => {
    expect(formatStateName("Todo")).toBe("Todo");
  });
});
