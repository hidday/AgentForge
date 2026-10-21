import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("mockLinearData", () => {
  it("MOCK_ISSUE has the shape of a valid LinearIssue", () => {
    expect(MOCK_ISSUE.id).toBe("LIN-1042");
    expect(MOCK_ISSUE.identifier).toBe("LIN-1042");
    expect(MOCK_ISSUE.branchName).toMatch(/^mock\//);
    expect(MOCK_ISSUE.title.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.description).toContain("## Problem");
    expect(MOCK_ISSUE.labels).toEqual(["bug", "api", "validation"]);
    expect(MOCK_ISSUE.state).toBe("Todo");
  });

  it("MOCK_LINEAR_STATES maps every lifecycle key to its Linear display name", () => {
    expect(MOCK_LINEAR_STATES).toEqual({
      todo: "Todo",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
      cancelled: "Cancelled",
    });
  });
});
