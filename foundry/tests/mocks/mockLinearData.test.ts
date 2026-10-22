import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("MOCK_ISSUE fixture", () => {
  it("satisfies the required LinearIssue fields", () => {
    expect(typeof MOCK_ISSUE.id).toBe("string");
    expect(MOCK_ISSUE.id.length).toBeGreaterThan(0);
    expect(typeof MOCK_ISSUE.title).toBe("string");
    expect(MOCK_ISSUE.title.length).toBeGreaterThan(0);
    expect(typeof MOCK_ISSUE.description).toBe("string");
    expect(MOCK_ISSUE.description.length).toBeGreaterThan(0);
    expect(typeof MOCK_ISSUE.branchName).toBe("string");
    expect(typeof MOCK_ISSUE.state).toBe("string");
    expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
    expect(typeof MOCK_ISSUE.priority).toBe("number");
  });
});

describe("MOCK_LINEAR_STATES fixture", () => {
  it("has the five expected workflow states, each a non-empty string", () => {
    const keys = ["todo", "inProgress", "inReview", "done", "cancelled"] as const;
    for (const key of keys) {
      expect(typeof MOCK_LINEAR_STATES[key]).toBe("string");
      expect(MOCK_LINEAR_STATES[key].length).toBeGreaterThan(0);
    }
    expect(Object.keys(MOCK_LINEAR_STATES)).toHaveLength(5);
  });
});
