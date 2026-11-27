import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("MOCK_ISSUE", () => {
  it("has consistent id and identifier fields", () => {
    expect(MOCK_ISSUE.id).toBe(MOCK_ISSUE.identifier);
    expect(typeof MOCK_ISSUE.id).toBe("string");
    expect(MOCK_ISSUE.id.length).toBeGreaterThan(0);
  });

  it("has a non-empty title, description, and url", () => {
    expect(MOCK_ISSUE.title.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.description.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.url).toMatch(/^https:\/\//);
  });

  it("has a branchName that is URL/git-safe (lowercase, no spaces)", () => {
    expect(MOCK_ISSUE.branchName).toMatch(/^[a-z0-9/_-]+$/);
    expect(MOCK_ISSUE.branchName).not.toContain(" ");
  });

  it("has a branchName that references the issue identifier", () => {
    expect(MOCK_ISSUE.branchName.toLowerCase()).toContain(MOCK_ISSUE.identifier.toLowerCase());
  });

  it("has a priority within the valid 0-4 range", () => {
    expect(MOCK_ISSUE.priority).toBeGreaterThanOrEqual(0);
    expect(MOCK_ISSUE.priority).toBeLessThanOrEqual(4);
  });

  it("has a non-empty labels array of strings", () => {
    expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
    expect(MOCK_ISSUE.labels.length).toBeGreaterThan(0);
    for (const label of MOCK_ISSUE.labels) {
      expect(typeof label).toBe("string");
    }
  });

  it("has a description that includes the standard sections used by the planner prompts", () => {
    expect(MOCK_ISSUE.description).toContain("## Problem");
    expect(MOCK_ISSUE.description).toContain("## Requirements");
    expect(MOCK_ISSUE.description).toContain("## Acceptance Criteria");
  });

  it("is one of the known Linear states", () => {
    expect(Object.values(MOCK_LINEAR_STATES)).toContain(MOCK_ISSUE.state);
  });
});

describe("MOCK_LINEAR_STATES", () => {
  it("defines the five standard Linear workflow states", () => {
    expect(MOCK_LINEAR_STATES.todo).toBe("Todo");
    expect(MOCK_LINEAR_STATES.inProgress).toBe("In Progress");
    expect(MOCK_LINEAR_STATES.inReview).toBe("In Review");
    expect(MOCK_LINEAR_STATES.done).toBe("Done");
    expect(MOCK_LINEAR_STATES.cancelled).toBe("Cancelled");
  });

  it("has no duplicate state label values", () => {
    const values = Object.values(MOCK_LINEAR_STATES);
    expect(new Set(values).size).toBe(values.length);
  });
});
