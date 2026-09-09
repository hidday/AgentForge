import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("mockLinearData", () => {
  it("MOCK_ISSUE has the expected identifying fields", () => {
    expect(MOCK_ISSUE.id).toBe("LIN-1042");
    expect(MOCK_ISSUE.identifier).toBe("LIN-1042");
    expect(MOCK_ISSUE.state).toBe("Todo");
    expect(MOCK_ISSUE.labels).toEqual(["bug", "api", "validation"]);
    expect(MOCK_ISSUE.description).toContain("## Problem");
  });

  it("MOCK_LINEAR_STATES enumerates the expected workflow state names", () => {
    expect(MOCK_LINEAR_STATES).toEqual({
      todo: "Todo",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
      cancelled: "Cancelled",
    });
  });
});
