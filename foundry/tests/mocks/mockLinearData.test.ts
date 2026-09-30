import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("mockLinearData", () => {
  describe("MOCK_ISSUE", () => {
    it("has the required LinearIssue fields with correct types", () => {
      expect(typeof MOCK_ISSUE.id).toBe("string");
      expect(typeof MOCK_ISSUE.identifier).toBe("string");
      expect(typeof MOCK_ISSUE.title).toBe("string");
      expect(typeof MOCK_ISSUE.branchName).toBe("string");
      expect(typeof MOCK_ISSUE.description).toBe("string");
      expect(typeof MOCK_ISSUE.state).toBe("string");
      expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
      expect(typeof MOCK_ISSUE.priority).toBe("number");
    });

    it("has a priority within the valid 0-4 range used elsewhere in the schemas", () => {
      expect(MOCK_ISSUE.priority).toBeGreaterThanOrEqual(0);
      expect(MOCK_ISSUE.priority).toBeLessThanOrEqual(4);
    });

    it("has a non-empty description containing the expected sections", () => {
      expect(MOCK_ISSUE.description).toContain("## Problem");
      expect(MOCK_ISSUE.description).toContain("## Requirements");
      expect(MOCK_ISSUE.description).toContain("## Acceptance Criteria");
    });

    it("has a url that references its own identifier", () => {
      expect(MOCK_ISSUE.url).toContain(MOCK_ISSUE.identifier);
    });

    it("has a branchName derived in a slug-like form from the identifier", () => {
      expect(MOCK_ISSUE.branchName.toLowerCase()).toContain(MOCK_ISSUE.identifier.toLowerCase());
    });
  });

  describe("MOCK_LINEAR_STATES", () => {
    it("exposes exactly the expected workflow state keys with string values", () => {
      expect(Object.keys(MOCK_LINEAR_STATES).sort()).toEqual(
        ["cancelled", "done", "inProgress", "inReview", "todo"].sort(),
      );
      for (const value of Object.values(MOCK_LINEAR_STATES)) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    });

    it("has no duplicate state label values", () => {
      const values = Object.values(MOCK_LINEAR_STATES);
      expect(new Set(values).size).toBe(values.length);
    });

    it("uses MOCK_ISSUE.state as one of its known state labels", () => {
      expect(Object.values(MOCK_LINEAR_STATES)).toContain(MOCK_ISSUE.state);
    });
  });
});
