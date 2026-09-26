import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("mockLinearData fixtures", () => {
  it("MOCK_ISSUE has the fields LinearIssue consumers expect", () => {
    expect(MOCK_ISSUE.id).toBe("LIN-1042");
    expect(MOCK_ISSUE.identifier).toBe("LIN-1042");
    expect(typeof MOCK_ISSUE.title).toBe("string");
    expect(MOCK_ISSUE.title.length).toBeGreaterThan(0);
    expect(typeof MOCK_ISSUE.description).toBe("string");
    expect(MOCK_ISSUE.description).toContain("## Problem");
    expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
    expect(MOCK_ISSUE.labels).toContain("bug");
  });

  it("MOCK_LINEAR_STATES maps every known lifecycle state to its Linear label", () => {
    expect(MOCK_LINEAR_STATES).toEqual({
      todo: "Todo",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
      cancelled: "Cancelled",
    });
  });
});
