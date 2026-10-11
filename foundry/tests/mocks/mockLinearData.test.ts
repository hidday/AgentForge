import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("MOCK_ISSUE", () => {
  it("has all required LinearIssue fields with the expected types", () => {
    expect(typeof MOCK_ISSUE.id).toBe("string");
    expect(typeof MOCK_ISSUE.identifier).toBe("string");
    expect(typeof MOCK_ISSUE.title).toBe("string");
    expect(typeof MOCK_ISSUE.branchName).toBe("string");
    expect(typeof MOCK_ISSUE.description).toBe("string");
    expect(typeof MOCK_ISSUE.state).toBe("string");
    expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
    expect(typeof MOCK_ISSUE.priority).toBe("number");
  });

  it("has a priority within the valid 0-4 range used by IssueSchema", () => {
    expect(MOCK_ISSUE.priority).toBeGreaterThanOrEqual(0);
    expect(MOCK_ISSUE.priority).toBeLessThanOrEqual(4);
    expect(Number.isInteger(MOCK_ISSUE.priority)).toBe(true);
  });

  it("has a branch name derived from the mock prefix and identifier", () => {
    expect(MOCK_ISSUE.branchName).toMatch(/^mock\//);
    expect(MOCK_ISSUE.branchName.toLowerCase()).toContain("lin-1042");
  });

  it("has a well-formed Linear issue URL when present", () => {
    expect(MOCK_ISSUE.url).toBeDefined();
    expect(MOCK_ISSUE.url).toMatch(/^https:\/\//);
  });

  it("has a non-empty description containing the expected sections", () => {
    expect(MOCK_ISSUE.description).toContain("## Problem");
    expect(MOCK_ISSUE.description).toContain("## Requirements");
    expect(MOCK_ISSUE.description).toContain("## Acceptance Criteria");
  });
});

describe("MOCK_LINEAR_STATES", () => {
  it("exposes the expected set of workflow state labels", () => {
    expect(MOCK_LINEAR_STATES).toEqual({
      todo: "Todo",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
      cancelled: "Cancelled",
    });
  });

  it("maps the mock issue's current state to one of the known states", () => {
    const knownStates = Object.values(MOCK_LINEAR_STATES);
    expect(knownStates).toContain(MOCK_ISSUE.state);
  });
});
