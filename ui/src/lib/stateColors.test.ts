import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
} from "./stateColors.ts";

describe("getStateCategory", () => {
  it("maps a known active state", () => {
    expect(getStateCategory("Implementing")).toBe("active");
  });

  it("maps a known waiting state", () => {
    expect(getStateCategory("AwaitingPlanApproval")).toBe("waiting");
  });

  it("maps a known blocked state", () => {
    expect(getStateCategory("AIBlocked")).toBe("blocked");
  });

  it("maps a known done state", () => {
    expect(getStateCategory("Done")).toBe("done");
  });

  it("falls back to idle for an unrecognized state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });
});

describe("getStateBadgeClass / getStateDotClass", () => {
  it("returns the active badge and dot classes for an active state", () => {
    expect(getStateBadgeClass("Implementing")).toContain("state-active");
    expect(getStateDotClass("Implementing")).toContain("state-active");
  });

  it("returns the idle badge and dot classes for an unknown state", () => {
    expect(getStateBadgeClass("Nonsense")).toContain("state-idle");
    expect(getStateDotClass("Nonsense")).toContain("state-idle");
  });

  it("returns distinct classes for blocked vs done states", () => {
    expect(getStateBadgeClass("AIBlocked")).toContain("state-blocked");
    expect(getStateBadgeClass("Done")).toContain("state-done");
  });
});

describe("formatStateName", () => {
  it("inserts spaces before internal capital letters", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("leaves a single-word state unchanged", () => {
    expect(formatStateName("Done")).toBe("Done");
  });

  it("trims any resulting leading whitespace", () => {
    // Guards the trim() call explicitly, even though PascalCase inputs from
    // this codebase never start with a lowercase letter in practice.
    expect(formatStateName("Todo").startsWith(" ")).toBe(false);
  });
});
