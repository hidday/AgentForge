import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
} from "./stateColors.ts";

describe("getStateCategory", () => {
  it("maps each known run state to its category", () => {
    expect(getStateCategory("Todo")).toBe("idle");
    expect(getStateCategory("Planning")).toBe("active");
    expect(getStateCategory("AwaitingPlanApproval")).toBe("waiting");
    expect(getStateCategory("Done")).toBe("done");
    expect(getStateCategory("AIBlocked")).toBe("blocked");
  });

  it("defaults to idle for an unrecognized state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });
});

describe("getStateBadgeClass / getStateDotClass", () => {
  it("returns the active category classes for an active state", () => {
    expect(getStateBadgeClass("Implementing")).toContain("state-active");
    expect(getStateDotClass("Implementing")).toContain("state-active");
  });

  it("returns the done category classes for Done", () => {
    expect(getStateBadgeClass("Done")).toContain("state-done");
    expect(getStateDotClass("Done")).toContain("state-done");
  });

  it("returns the idle category classes for an unknown state", () => {
    expect(getStateBadgeClass("Bogus")).toContain("state-idle");
    expect(getStateDotClass("Bogus")).toContain("state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts spaces before capital letters and trims the result", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state unchanged", () => {
    expect(formatStateName("Todo")).toBe("Todo");
  });
});
