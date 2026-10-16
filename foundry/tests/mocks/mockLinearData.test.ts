import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("MOCK_ISSUE", () => {
  it("has the expected identifying fields", () => {
    expect(MOCK_ISSUE.id).toBe("LIN-1042");
    expect(MOCK_ISSUE.identifier).toBe("LIN-1042");
    expect(MOCK_ISSUE.title).toBe("Add request validation middleware to API endpoints");
    expect(MOCK_ISSUE.branchName).toBe("mock/lin-1042-add-request-validation-middleware");
    expect(MOCK_ISSUE.state).toBe("Todo");
    expect(MOCK_ISSUE.priority).toBe(2);
    expect(MOCK_ISSUE.project).toBe("Backend Platform");
    expect(MOCK_ISSUE.cycle).toBe("Sprint 23");
    expect(MOCK_ISSUE.url).toBe("https://linear.app/mock-team/issue/LIN-1042");
  });

  it("has a non-empty labels array", () => {
    expect(MOCK_ISSUE.labels).toEqual(["bug", "api", "validation"]);
  });

  it("has a description containing the key requirement sections", () => {
    expect(MOCK_ISSUE.description).toContain("## Problem");
    expect(MOCK_ISSUE.description).toContain("## Requirements");
    expect(MOCK_ISSUE.description).toContain("## Acceptance Criteria");
  });

  it("satisfies the required shape of a LinearIssue (required fields present with correct types)", () => {
    expect(typeof MOCK_ISSUE.id).toBe("string");
    expect(typeof MOCK_ISSUE.title).toBe("string");
    expect(typeof MOCK_ISSUE.description).toBe("string");
    expect(typeof MOCK_ISSUE.branchName).toBe("string");
    expect(typeof MOCK_ISSUE.state).toBe("string");
    expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
    expect(typeof MOCK_ISSUE.priority).toBe("number");
  });
});

describe("MOCK_LINEAR_STATES", () => {
  it("maps each lifecycle key to its Linear display state", () => {
    expect(MOCK_LINEAR_STATES).toEqual({
      todo: "Todo",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
      cancelled: "Cancelled",
    });
  });

  it("uses the same 'Todo' value referenced by MOCK_ISSUE.state", () => {
    expect(MOCK_LINEAR_STATES.todo).toBe(MOCK_ISSUE.state);
  });
});
