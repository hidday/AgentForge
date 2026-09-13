import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";
import { IssueSchema } from "../../src/schemas/taskBundle.js";

describe("MOCK_ISSUE", () => {
  it("satisfies the shared IssueSchema (id, title, description, labels, priority, project, cycle)", () => {
    const result = IssueSchema.safeParse(MOCK_ISSUE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(MOCK_ISSUE.id);
      expect(result.data.priority).toBe(MOCK_ISSUE.priority);
    }
  });

  it("has a priority within the valid 0-4 range and non-empty labels", () => {
    expect(MOCK_ISSUE.priority).toBeGreaterThanOrEqual(0);
    expect(MOCK_ISSUE.priority).toBeLessThanOrEqual(4);
    expect(MOCK_ISSUE.labels.length).toBeGreaterThan(0);
  });

  it("carries Linear-specific fields not covered by IssueSchema (identifier, branchName, state, url)", () => {
    expect(MOCK_ISSUE.identifier).toBe("LIN-1042");
    expect(MOCK_ISSUE.branchName).toMatch(/^mock\//);
    expect(MOCK_ISSUE.state).toBe("Todo");
    expect(MOCK_ISSUE.url).toContain("linear.app");
  });
});

describe("MOCK_LINEAR_STATES", () => {
  it("exposes the five expected Linear workflow state labels", () => {
    expect(MOCK_LINEAR_STATES).toEqual({
      todo: "Todo",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
      cancelled: "Cancelled",
    });
  });

  it("matches MOCK_ISSUE's own state value for its todo key", () => {
    expect(MOCK_LINEAR_STATES.todo).toBe(MOCK_ISSUE.state);
  });
});
