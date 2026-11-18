import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("mockLinearData", () => {
  it("MOCK_ISSUE has the shape of a LinearIssue with non-empty content", () => {
    expect(MOCK_ISSUE.id).toBe("LIN-1042");
    expect(MOCK_ISSUE.identifier).toBe("LIN-1042");
    expect(MOCK_ISSUE.title.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.description).toContain("## Problem");
    expect(MOCK_ISSUE.description).toContain("## Acceptance Criteria");
    expect(MOCK_ISSUE.state).toBe("Todo");
    expect(MOCK_ISSUE.labels).toEqual(["bug", "api", "validation"]);
    expect(MOCK_ISSUE.priority).toBe(2);
    expect(MOCK_ISSUE.url).toMatch(/^https:\/\/linear\.app\//);
    expect(MOCK_ISSUE.branchName).toBe("mock/lin-1042-add-request-validation-middleware");
    expect(MOCK_ISSUE.project).toBe("Backend Platform");
    expect(MOCK_ISSUE.cycle).toBe("Sprint 23");
  });

  it("MOCK_LINEAR_STATES enumerates the expected Linear workflow states", () => {
    expect(MOCK_LINEAR_STATES).toEqual({
      todo: "Todo",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
      cancelled: "Cancelled",
    });
  });
});
