import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";
import { IssueSchema } from "../../src/schemas/taskBundle.js";

describe("MOCK_ISSUE", () => {
  it("has the expected identifying fields", () => {
    expect(MOCK_ISSUE.id).toBe("LIN-1042");
    expect(MOCK_ISSUE.identifier).toBe("LIN-1042");
    expect(MOCK_ISSUE.branchName).toBe("mock/lin-1042-add-request-validation-middleware");
    expect(MOCK_ISSUE.state).toBe("Todo");
    expect(MOCK_ISSUE.url).toContain("linear.app");
  });

  it("has a non-empty title, description, labels and priority within bounds", () => {
    expect(MOCK_ISSUE.title.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.description.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.labels.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.priority).toBeGreaterThanOrEqual(0);
    expect(MOCK_ISSUE.priority).toBeLessThanOrEqual(4);
  });

  it("includes the expected Problem/Requirements/Acceptance Criteria sections", () => {
    expect(MOCK_ISSUE.description).toContain("## Problem");
    expect(MOCK_ISSUE.description).toContain("## Requirements");
    expect(MOCK_ISSUE.description).toContain("## Acceptance Criteria");
  });

  it("satisfies the shared IssueSchema shape used by the rest of the system", () => {
    const result = IssueSchema.safeParse(MOCK_ISSUE);
    expect(result.success).toBe(true);
  });
});

describe("MOCK_LINEAR_STATES", () => {
  it("defines the five expected workflow states with their display labels", () => {
    expect(MOCK_LINEAR_STATES).toEqual({
      todo: "Todo",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
      cancelled: "Cancelled",
    });
  });

  it("matches MOCK_ISSUE's state value for the 'todo' key", () => {
    expect(MOCK_LINEAR_STATES.todo).toBe(MOCK_ISSUE.state);
  });
});
