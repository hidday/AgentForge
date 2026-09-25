import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("MOCK_ISSUE", () => {
  it("has the exact expected identifying fields", () => {
    expect(MOCK_ISSUE.id).toBe("LIN-1042");
    expect(MOCK_ISSUE.identifier).toBe("LIN-1042");
    expect(MOCK_ISSUE.title).toBe("Add request validation middleware to API endpoints");
    expect(MOCK_ISSUE.branchName).toBe("mock/lin-1042-add-request-validation-middleware");
    expect(MOCK_ISSUE.state).toBe("Todo");
    expect(MOCK_ISSUE.url).toBe("https://linear.app/mock-team/issue/LIN-1042");
    expect(MOCK_ISSUE.project).toBe("Backend Platform");
    expect(MOCK_ISSUE.cycle).toBe("Sprint 23");
  });

  it("has the expected labels and priority", () => {
    expect(MOCK_ISSUE.labels).toEqual(["bug", "api", "validation"]);
    expect(MOCK_ISSUE.priority).toBe(2);
  });

  it("has a non-empty markdown description containing the expected sections", () => {
    expect(typeof MOCK_ISSUE.description).toBe("string");
    expect(MOCK_ISSUE.description).toContain("## Problem");
    expect(MOCK_ISSUE.description).toContain("## Requirements");
    expect(MOCK_ISSUE.description).toContain("## Acceptance Criteria");
  });

  it("matches the LinearIssue shape field-for-field", () => {
    expect(MOCK_ISSUE).toMatchObject({
      id: expect.any(String),
      identifier: expect.any(String),
      title: expect.any(String),
      branchName: expect.any(String),
      description: expect.any(String),
      state: expect.any(String),
      labels: expect.any(Array),
      priority: expect.any(Number),
      url: expect.any(String),
      project: expect.any(String),
      cycle: expect.any(String),
    });
  });
});

describe("MOCK_LINEAR_STATES", () => {
  it("has the exact expected state name mappings", () => {
    expect(MOCK_LINEAR_STATES).toEqual({
      todo: "Todo",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
      cancelled: "Cancelled",
    });
  });

  it("has exactly the five expected keys", () => {
    expect(Object.keys(MOCK_LINEAR_STATES).sort()).toEqual(
      ["cancelled", "done", "inProgress", "inReview", "todo"].sort(),
    );
  });
});
