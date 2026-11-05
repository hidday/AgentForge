import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
} from "./stateColors.ts";

describe("stateColors", () => {
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

    it("falls back to 'idle' for an unknown state", () => {
      expect(getStateCategory("SomethingMadeUp")).toBe("idle");
      expect(getStateCategory("")).toBe("idle");
    });
  });

  describe("getStateBadgeClass", () => {
    it("returns the badge classes for each category", () => {
      expect(getStateBadgeClass("Planning")).toContain("state-active");
      expect(getStateBadgeClass("AwaitingPlanApproval")).toContain("state-waiting");
      expect(getStateBadgeClass("AIBlocked")).toContain("state-blocked");
      expect(getStateBadgeClass("Done")).toContain("state-done");
      expect(getStateBadgeClass("Todo")).toContain("state-idle");
    });

    it("falls back to the idle badge class for an unknown state", () => {
      expect(getStateBadgeClass("Unknown")).toBe(
        "bg-state-idle-bg text-state-idle border-state-idle/30",
      );
    });
  });

  describe("getStateDotClass", () => {
    it("returns the dot class for each category", () => {
      expect(getStateDotClass("Planning")).toBe("bg-state-active");
      expect(getStateDotClass("AwaitingPlanApproval")).toBe("bg-state-waiting");
      expect(getStateDotClass("AIBlocked")).toBe("bg-state-blocked");
      expect(getStateDotClass("Done")).toBe("bg-state-done");
      expect(getStateDotClass("Todo")).toBe("bg-state-idle");
    });

    it("falls back to the idle dot class for an unknown state", () => {
      expect(getStateDotClass("Unknown")).toBe("bg-state-idle");
    });
  });

  describe("formatStateName", () => {
    it("inserts a space before each capital letter in a PascalCase name", () => {
      expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
      expect(formatStateName("Todo")).toBe("Todo");
      expect(formatStateName("AIBlocked")).toBe("AIBlocked".replace(/([A-Z])/g, " $1").trim());
    });

    it("trims leading whitespace produced by a leading capital", () => {
      // The regex would otherwise prefix a leading space for the first letter.
      expect(formatStateName("Done").startsWith(" ")).toBe(false);
    });

    it("returns an empty string unchanged", () => {
      expect(formatStateName("")).toBe("");
    });
  });
});
