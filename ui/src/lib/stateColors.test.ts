import { describe, it, expect } from "vitest";
import {
  getStateCategory,
  getStateBadgeClass,
  getStateDotClass,
  formatStateName,
} from "./stateColors.ts";

describe("stateColors", () => {
  describe("getStateCategory", () => {
    it("maps every known workflow state to its documented category", () => {
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

    it("falls back to 'idle' for an unrecognized state", () => {
      expect(getStateCategory("SomeUnknownState")).toBe("idle");
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

    it("falls back to idle badge classes for an unknown state", () => {
      expect(getStateBadgeClass("Bogus")).toContain("state-idle");
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

    it("falls back to idle dot class for an unknown state", () => {
      expect(getStateDotClass("Bogus")).toBe("bg-state-idle");
    });
  });

  describe("formatStateName", () => {
    it("inserts a space before each interior capital letter", () => {
      expect(formatStateName("AwaitingPlanApproval")).toBe("Awaiting Plan Approval");
      expect(formatStateName("AIBlocked")).toBe("A I Blocked");
    });

    it("leaves a single-word state unchanged", () => {
      expect(formatStateName("Todo")).toBe("Todo");
      expect(formatStateName("Done")).toBe("Done");
    });

    it("handles an empty string", () => {
      expect(formatStateName("")).toBe("");
    });
  });
});
