import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("MOCK_ISSUE", () => {
  it("matches the expected LinearIssue shape and identifying fields", () => {
    expect(MOCK_ISSUE).toMatchObject({
      id: "LIN-1042",
      identifier: "LIN-1042",
      title: "Add request validation middleware to API endpoints",
      branchName: "mock/lin-1042-add-request-validation-middleware",
      state: "Todo",
      priority: 2,
      project: "Backend Platform",
      cycle: "Sprint 23",
    });
  });

  it("has a url pointing at the mock-team workspace for this issue", () => {
    expect(MOCK_ISSUE.url).toBe("https://linear.app/mock-team/issue/LIN-1042");
  });

  it("has a non-empty labels array including 'validation'", () => {
    expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
    expect(MOCK_ISSUE.labels).toContain("validation");
  });

  it("has a description containing the Problem, Requirements, and Acceptance Criteria sections", () => {
    expect(MOCK_ISSUE.description).toContain("## Problem");
    expect(MOCK_ISSUE.description).toContain("## Requirements");
    expect(MOCK_ISSUE.description).toContain("## Acceptance Criteria");
  });
});

describe("MOCK_LINEAR_STATES", () => {
  it("defines the five expected workflow state names", () => {
    expect(MOCK_LINEAR_STATES).toEqual({
      todo: "Todo",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
      cancelled: "Cancelled",
    });
  });

  it("has all distinct values", () => {
    const values = Object.values(MOCK_LINEAR_STATES);
    expect(new Set(values).size).toBe(values.length);
  });
});
