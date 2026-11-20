import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("mockLinearData", () => {
  describe("MOCK_ISSUE", () => {
    it("has the core identifying fields", () => {
      expect(MOCK_ISSUE.id).toBe("LIN-1042");
      expect(MOCK_ISSUE.identifier).toBe("LIN-1042");
      expect(MOCK_ISSUE.title).toContain("request validation");
      expect(MOCK_ISSUE.url).toContain("linear.app");
    });

    it("has a non-empty markdown description with the expected sections", () => {
      expect(typeof MOCK_ISSUE.description).toBe("string");
      expect(MOCK_ISSUE.description).toContain("## Problem");
      expect(MOCK_ISSUE.description).toContain("## Requirements");
      expect(MOCK_ISSUE.description).toContain("## Acceptance Criteria");
    });

    it("has labels as a non-empty string array and a numeric priority", () => {
      expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
      expect(MOCK_ISSUE.labels.length).toBeGreaterThan(0);
      expect(typeof MOCK_ISSUE.priority).toBe("number");
    });

    it("has a state matching one of the MOCK_LINEAR_STATES values", () => {
      expect(Object.values(MOCK_LINEAR_STATES)).toContain(MOCK_ISSUE.state);
    });

    it("has project and cycle metadata", () => {
      expect(MOCK_ISSUE.project).toBe("Backend Platform");
      expect(MOCK_ISSUE.cycle).toBe("Sprint 23");
    });
  });

  describe("MOCK_LINEAR_STATES", () => {
    it("exposes the expected five lifecycle states", () => {
      expect(MOCK_LINEAR_STATES).toEqual({
        todo: "Todo",
        inProgress: "In Progress",
        inReview: "In Review",
        done: "Done",
        cancelled: "Cancelled",
      });
    });
  });
});
