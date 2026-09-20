import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

describe("MOCK_ISSUE", () => {
  it("satisfies the LinearIssue shape with all required fields populated", () => {
    const issue: LinearIssue = MOCK_ISSUE;
    expect(typeof issue.id).toBe("string");
    expect(issue.id.length).toBeGreaterThan(0);
    expect(typeof issue.title).toBe("string");
    expect(typeof issue.description).toBe("string");
    expect(typeof issue.branchName).toBe("string");
    expect(typeof issue.state).toBe("string");
    expect(Array.isArray(issue.labels)).toBe(true);
    expect(typeof issue.priority).toBe("number");
  });

  it("has a state that is one of the known mock Linear states", () => {
    expect(Object.values(MOCK_LINEAR_STATES)).toContain(MOCK_ISSUE.state);
  });

  it("has a priority within the valid 0-4 range", () => {
    expect(MOCK_ISSUE.priority).toBeGreaterThanOrEqual(0);
    expect(MOCK_ISSUE.priority).toBeLessThanOrEqual(4);
  });

  it("has a branch name derived in a URL/git-safe slug format", () => {
    expect(MOCK_ISSUE.branchName).toMatch(/^[a-z0-9/-]+$/);
  });

  it("has a description containing the expected structural sections", () => {
    expect(MOCK_ISSUE.description).toContain("## Problem");
    expect(MOCK_ISSUE.description).toContain("## Requirements");
    expect(MOCK_ISSUE.description).toContain("## Acceptance Criteria");
  });
});

describe("MOCK_LINEAR_STATES", () => {
  it("exposes exactly the expected workflow state keys with distinct values", () => {
    expect(Object.keys(MOCK_LINEAR_STATES).sort()).toEqual(
      ["cancelled", "done", "inProgress", "inReview", "todo"].sort(),
    );
    const values = Object.values(MOCK_LINEAR_STATES);
    expect(new Set(values).size).toBe(values.length);
  });

  it("maps each key to a human-readable, non-empty string", () => {
    for (const value of Object.values(MOCK_LINEAR_STATES)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
