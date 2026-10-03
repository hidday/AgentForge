import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("MOCK_ISSUE", () => {
  it("has all required LinearIssue fields with correct types", () => {
    expect(typeof MOCK_ISSUE.id).toBe("string");
    expect(MOCK_ISSUE.id.length).toBeGreaterThan(0);
    expect(typeof MOCK_ISSUE.title).toBe("string");
    expect(MOCK_ISSUE.title.length).toBeGreaterThan(0);
    expect(typeof MOCK_ISSUE.description).toBe("string");
    expect(MOCK_ISSUE.description.length).toBeGreaterThan(0);
    expect(typeof MOCK_ISSUE.branchName).toBe("string");
    expect(MOCK_ISSUE.branchName.length).toBeGreaterThan(0);
    expect(typeof MOCK_ISSUE.state).toBe("string");
    expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
    expect(MOCK_ISSUE.labels.every((l) => typeof l === "string")).toBe(true);
    expect(typeof MOCK_ISSUE.priority).toBe("number");
    expect(MOCK_ISSUE.priority).toBeGreaterThanOrEqual(0);
    expect(MOCK_ISSUE.priority).toBeLessThanOrEqual(4);
  });

  it("has well-formed optional fields (identifier, url, project, cycle)", () => {
    expect(MOCK_ISSUE.identifier).toBe(MOCK_ISSUE.id);
    expect(MOCK_ISSUE.url).toMatch(/^https?:\/\//);
    expect(typeof MOCK_ISSUE.project).toBe("string");
    expect(typeof MOCK_ISSUE.cycle).toBe("string");
  });

  it("includes structured sections in the description (Problem / Requirements / Acceptance Criteria)", () => {
    expect(MOCK_ISSUE.description).toContain("## Problem");
    expect(MOCK_ISSUE.description).toContain("## Requirements");
    expect(MOCK_ISSUE.description).toContain("## Acceptance Criteria");
  });

  it("derives the branchName from the issue identifier in lowercase", () => {
    const identifier = (MOCK_ISSUE.identifier ?? MOCK_ISSUE.id).toLowerCase();
    expect(MOCK_ISSUE.branchName.toLowerCase()).toContain(identifier);
  });
});

describe("MOCK_LINEAR_STATES", () => {
  it("defines all five lifecycle states as distinct non-empty strings", () => {
    const values = Object.values(MOCK_LINEAR_STATES);
    expect(values).toHaveLength(5);
    expect(new Set(values).size).toBe(5);
    for (const v of values) {
      expect(typeof v).toBe("string");
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it("has the expected keys mapped to human-readable labels", () => {
    expect(MOCK_LINEAR_STATES.todo).toBe("Todo");
    expect(MOCK_LINEAR_STATES.inProgress).toBe("In Progress");
    expect(MOCK_LINEAR_STATES.inReview).toBe("In Review");
    expect(MOCK_LINEAR_STATES.done).toBe("Done");
    expect(MOCK_LINEAR_STATES.cancelled).toBe("Cancelled");
  });
});
