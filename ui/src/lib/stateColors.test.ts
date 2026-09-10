import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
} from "./stateColors";

describe("getStateCategory", () => {
  it("maps known states to their category", () => {
    expect(getStateCategory("Todo")).toBe("idle");
    expect(getStateCategory("Planning")).toBe("active");
    expect(getStateCategory("AwaitingPlanApproval")).toBe("waiting");
    expect(getStateCategory("Done")).toBe("done");
    expect(getStateCategory("AIBlocked")).toBe("blocked");
  });

  it("falls back to idle for an unrecognized state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the badge classes for the state's category", () => {
    expect(getStateBadgeClass("Done")).toContain("state-done");
    expect(getStateBadgeClass("AIBlocked")).toContain("state-blocked");
  });

  it("returns the idle badge classes for an unknown state", () => {
    expect(getStateBadgeClass("Nonsense")).toContain("state-idle");
  });
});

describe("getStateDotClass", () => {
  it("returns the dot class for the state's category", () => {
    expect(getStateDotClass("ReadyForHumanReview")).toBe("bg-state-waiting");
  });

  it("returns the idle dot class for an unknown state", () => {
    expect(getStateDotClass("Nonsense")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts spaces before capital letters and trims the result", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state unchanged", () => {
    expect(formatStateName("Done")).toBe("Done");
  });
});
