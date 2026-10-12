import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("mockLinearData", () => {
  describe("MOCK_ISSUE", () => {
    it("has all the required LinearIssue fields with the expected types", () => {
      expect(typeof MOCK_ISSUE.id).toBe("string");
      expect(MOCK_ISSUE.id.length).toBeGreaterThan(0);
      expect(typeof MOCK_ISSUE.title).toBe("string");
      expect(typeof MOCK_ISSUE.description).toBe("string");
      expect(typeof MOCK_ISSUE.branchName).toBe("string");
      expect(typeof MOCK_ISSUE.state).toBe("string");
      expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
      expect(typeof MOCK_ISSUE.priority).toBe("number");
    });

    it("has a branchName that is git-ref safe (lowercase, no spaces)", () => {
      expect(MOCK_ISSUE.branchName).toMatch(/^[a-z0-9/_-]+$/);
    });

    it("has a non-empty, well-formed description with the expected sections", () => {
      expect(MOCK_ISSUE.description).toContain("## Problem");
      expect(MOCK_ISSUE.description).toContain("## Requirements");
      expect(MOCK_ISSUE.description).toContain("## Acceptance Criteria");
    });

    it("has a priority within the valid Linear priority range (0-4)", () => {
      expect(MOCK_ISSUE.priority).toBeGreaterThanOrEqual(0);
      expect(MOCK_ISSUE.priority).toBeLessThanOrEqual(4);
    });

    it("has a valid-looking Linear issue URL containing its identifier", () => {
      expect(MOCK_ISSUE.url).toContain("linear.app");
      expect(MOCK_ISSUE.url).toContain(MOCK_ISSUE.identifier);
    });

    it("has a non-empty labels array of strings", () => {
      expect(MOCK_ISSUE.labels.length).toBeGreaterThan(0);
      for (const label of MOCK_ISSUE.labels) {
        expect(typeof label).toBe("string");
      }
    });
  });

  describe("MOCK_LINEAR_STATES", () => {
    it("exposes the expected lifecycle state keys mapped to display names", () => {
      expect(MOCK_LINEAR_STATES.todo).toBe("Todo");
      expect(MOCK_LINEAR_STATES.inProgress).toBe("In Progress");
      expect(MOCK_LINEAR_STATES.inReview).toBe("In Review");
      expect(MOCK_LINEAR_STATES.done).toBe("Done");
      expect(MOCK_LINEAR_STATES.cancelled).toBe("Cancelled");
    });

    it("has MOCK_ISSUE.state matching one of the known states", () => {
      expect(Object.values(MOCK_LINEAR_STATES)).toContain(MOCK_ISSUE.state);
    });
  });
});
