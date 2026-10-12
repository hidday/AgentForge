import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
  type StateCategory,
} from "./stateColors";

const STATE_TO_CATEGORY: Record<string, StateCategory> = {
  Todo: "idle",
  Planning: "active",
  PlanReview: "active",
  PlanRevision: "active",
  AwaitingPlanApproval: "waiting",
  Implementing: "active",
  AIReview: "active",
  AddressingReview: "active",
  ReadyForHumanReview: "waiting",
  Done: "done",
  AIBlocked: "blocked",
  HumanClarificationNeeded: "waiting",
};

describe("getStateCategory", () => {
  for (const [state, category] of Object.entries(STATE_TO_CATEGORY)) {
    it(`maps ${state} -> ${category}`, () => {
      expect(getStateCategory(state)).toBe(category);
    });
  }

  it("falls back to 'idle' for an unknown state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });

  it("falls back to 'idle' for an empty string", () => {
    expect(getStateCategory("")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the active badge classes for an active state", () => {
    const result = getStateBadgeClass("Planning");
    expect(result).toBe(
      "bg-state-active-bg text-state-active border-state-active/30",
    );
  });

  it("returns the waiting badge classes for a waiting state", () => {
    const result = getStateBadgeClass("AwaitingPlanApproval");
    expect(result).toBe(
      "bg-state-waiting-bg text-state-waiting border-state-waiting/30",
    );
  });

  it("returns the blocked badge classes for a blocked state", () => {
    const result = getStateBadgeClass("AIBlocked");
    expect(result).toBe(
      "bg-state-blocked-bg text-state-blocked border-state-blocked/30",
    );
  });

  it("returns the done badge classes for a done state", () => {
    const result = getStateBadgeClass("Done");
    expect(result).toBe("bg-state-done-bg text-state-done border-state-done/30");
  });

  it("returns the idle badge classes for an unknown state", () => {
    const result = getStateBadgeClass("NotARealState");
    expect(result).toBe("bg-state-idle-bg text-state-idle border-state-idle/30");
  });
});

describe("getStateDotClass", () => {
  it("returns the active dot class for an active state", () => {
    expect(getStateDotClass("Implementing")).toBe("bg-state-active");
  });

  it("returns the waiting dot class for a waiting state", () => {
    expect(getStateDotClass("ReadyForHumanReview")).toBe("bg-state-waiting");
  });

  it("returns the blocked dot class for a blocked state", () => {
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
  });

  it("returns the done dot class for a done state", () => {
    expect(getStateDotClass("Done")).toBe("bg-state-done");
  });

  it("returns the idle dot class for an unknown state", () => {
    expect(getStateDotClass("Mystery")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts spaces before each interior capital letter", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe(
      "Awaiting Plan Approval",
    );
  });

  it("separates consecutive capitals", () => {
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("leaves a single lowercase word unchanged", () => {
    expect(formatStateName("done")).toBe("done");
  });

  it("leaves a single capitalized word with no interior caps as itself (trimmed)", () => {
    expect(formatStateName("Todo")).toBe("Todo");
  });

  it("returns an empty string for an empty input", () => {
    expect(formatStateName("")).toBe("");
  });
});
