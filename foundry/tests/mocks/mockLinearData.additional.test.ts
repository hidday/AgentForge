import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("MOCK_ISSUE", () => {
  it("has the required LinearIssue-shaped fields with correct types", () => {
    expect(typeof MOCK_ISSUE.id).toBe("string");
    expect(typeof MOCK_ISSUE.identifier).toBe("string");
    expect(typeof MOCK_ISSUE.title).toBe("string");
    expect(typeof MOCK_ISSUE.branchName).toBe("string");
    expect(typeof MOCK_ISSUE.description).toBe("string");
    expect(typeof MOCK_ISSUE.state).toBe("string");
    expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
    expect(typeof MOCK_ISSUE.priority).toBe("number");
  });

  it("has a priority within the 0-4 range used elsewhere in the schema", () => {
    expect(MOCK_ISSUE.priority).toBeGreaterThanOrEqual(0);
    expect(MOCK_ISSUE.priority).toBeLessThanOrEqual(4);
  });

  it("has a non-empty description and at least one label", () => {
    expect(MOCK_ISSUE.description.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.labels.length).toBeGreaterThan(0);
  });

  it("has a branch name that looks like a slugified branch identifier", () => {
    expect(MOCK_ISSUE.branchName).toMatch(/^[a-z0-9/_-]+$/);
  });
});

describe("MOCK_LINEAR_STATES", () => {
  it("defines all five expected lifecycle state keys as strings", () => {
    expect(Object.keys(MOCK_LINEAR_STATES).sort()).toEqual(
      ["cancelled", "done", "inProgress", "inReview", "todo"].sort(),
    );
    for (const value of Object.values(MOCK_LINEAR_STATES)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("exposes each state under a distinctly named key with distinct values", () => {
    expect(MOCK_LINEAR_STATES.todo).toBe("Todo");
    expect(MOCK_LINEAR_STATES.inProgress).toBe("In Progress");
    expect(MOCK_LINEAR_STATES.inReview).toBe("In Review");
    expect(MOCK_LINEAR_STATES.done).toBe("Done");
    expect(MOCK_LINEAR_STATES.cancelled).toBe("Cancelled");
  });
});
