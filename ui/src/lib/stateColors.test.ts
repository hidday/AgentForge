import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
} from "./stateColors.ts";

describe("getStateCategory", () => {
  const expected: Record<string, string> = {
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

  for (const [state, category] of Object.entries(expected)) {
    it(`maps ${state} to ${category}`, () => {
      expect(getStateCategory(state)).toBe(category);
    });
  }

  it("falls back to 'idle' for an unknown state", () => {
    expect(getStateCategory("SomeUnknownState")).toBe("idle");
  });
});

describe("getStateBadgeClass", () => {
  it("returns the active badge classes for an active-category state", () => {
    expect(getStateBadgeClass("Implementing")).toBe(
      "bg-state-active-bg text-state-active border-state-active/30",
    );
  });

  it("returns the waiting badge classes for a waiting-category state", () => {
    expect(getStateBadgeClass("AwaitingPlanApproval")).toBe(
      "bg-state-waiting-bg text-state-waiting border-state-waiting/30",
    );
  });

  it("returns the blocked badge classes for a blocked-category state", () => {
    expect(getStateBadgeClass("AIBlocked")).toBe(
      "bg-state-blocked-bg text-state-blocked border-state-blocked/30",
    );
  });

  it("returns the done badge classes for a done-category state", () => {
    expect(getStateBadgeClass("Done")).toBe(
      "bg-state-done-bg text-state-done border-state-done/30",
    );
  });

  it("returns the idle badge classes for an idle-category / unknown state", () => {
    expect(getStateBadgeClass("Todo")).toBe(
      "bg-state-idle-bg text-state-idle border-state-idle/30",
    );
    expect(getStateBadgeClass("Unknown")).toBe(
      "bg-state-idle-bg text-state-idle border-state-idle/30",
    );
  });
});

describe("getStateDotClass", () => {
  it("returns the active dot class for an active-category state", () => {
    expect(getStateDotClass("Implementing")).toBe("bg-state-active");
  });

  it("returns the waiting dot class for a waiting-category state", () => {
    expect(getStateDotClass("ReadyForHumanReview")).toBe("bg-state-waiting");
  });

  it("returns the blocked dot class for a blocked-category state", () => {
    expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
  });

  it("returns the done dot class for a done-category state", () => {
    expect(getStateDotClass("Done")).toBe("bg-state-done");
  });

  it("returns the idle dot class for an idle-category state", () => {
    expect(getStateDotClass("Todo")).toBe("bg-state-idle");
  });
});

describe("formatStateName", () => {
  it("inserts spaces before interior capital letters", () => {
    expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
  });

  it("trims the leading space introduced by a capitalized first letter", () => {
    // The regex inserts a space before every capital, including the first —
    // trim() must remove that leading space.
    expect(formatStateName("Done")).toBe("Done");
    expect(formatStateName("AIBlocked")).toBe("A I Blocked");
  });

  it("leaves an all-lowercase string unchanged", () => {
    expect(formatStateName("todo")).toBe("todo");
  });
});
