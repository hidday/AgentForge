import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("MOCK_ISSUE", () => {
  it("conforms to the LinearIssue shape with required fields populated", () => {
    expect(typeof MOCK_ISSUE.id).toBe("string");
    expect(MOCK_ISSUE.id.length).toBeGreaterThan(0);
    expect(typeof MOCK_ISSUE.title).toBe("string");
    expect(typeof MOCK_ISSUE.description).toBe("string");
    expect(typeof MOCK_ISSUE.branchName).toBe("string");
    expect(typeof MOCK_ISSUE.state).toBe("string");
    expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
    expect(typeof MOCK_ISSUE.priority).toBe("number");
  });

  it("has a state that is one of the documented MOCK_LINEAR_STATES values", () => {
    expect(Object.values(MOCK_LINEAR_STATES)).toContain(MOCK_ISSUE.state);
  });

  it("has a branchName that is git-ref safe (no whitespace)", () => {
    expect(MOCK_ISSUE.branchName).not.toMatch(/\s/);
  });

  it("has a priority within the valid 0-4 range used by IssueSchema", () => {
    expect(MOCK_ISSUE.priority).toBeGreaterThanOrEqual(0);
    expect(MOCK_ISSUE.priority).toBeLessThanOrEqual(4);
  });

  it("has a well-formed https URL", () => {
    expect(MOCK_ISSUE.url).toMatch(/^https:\/\//);
  });
});

describe("MOCK_LINEAR_STATES", () => {
  it("exposes the five canonical Linear workflow states as distinct values", () => {
    const values = Object.values(MOCK_LINEAR_STATES);
    expect(values).toEqual(["Todo", "In Progress", "In Review", "Done", "Cancelled"]);
    expect(new Set(values).size).toBe(values.length);
  });
});
