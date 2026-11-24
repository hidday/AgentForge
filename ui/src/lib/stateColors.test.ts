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
    expect(getStateCategory("AwaitingPlanApproval")).toBe("waiting");
    expect(getStateCategory("Done")).toBe("done");
    expect(getStateCategory("AIBlocked")).toBe("blocked");
  });

  it("falls back to 'idle' for an unknown state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });
});

describe("getStateBadgeClass / getStateDotClass", () => {
  it("returns the active badge/dot classes for an active state", () => {
    expect(getStateBadgeClass("Planning")).toContain("state-active");
    expect(getStateDotClass("Planning")).toContain("state-active");
  });

  it("returns the blocked badge/dot classes for a blocked state", () => {
    expect(getStateBadgeClass("AIBlocked")).toContain("state-blocked");
    expect(getStateDotClass("AIBlocked")).toContain("state-blocked");
  });

  it("returns the idle badge/dot classes for an unknown state", () => {
    expect(getStateBadgeClass("Bogus")).toContain("state-idle");
    expect(getStateDotClass("Bogus")).toContain("state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts a space before each internal capital letter", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state untouched", () => {
    expect(formatStateName("Todo")).toBe("Todo");
  });

  it("trims any resulting leading/trailing whitespace", () => {
    expect(formatStateName("AIBlocked")).toBe("AIBlocked".replace(/([A-Z])/g, " $1").trim());
    expect(formatStateName("AIBlocked").startsWith(" ")).toBe(false);
  });
});
