import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("MOCK_ISSUE", () => {
  it("has the shape of a LinearIssue with the expected identifiers", () => {
    expect(MOCK_ISSUE).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        identifier: expect.any(String),
        title: expect.any(String),
        branchName: expect.any(String),
        description: expect.any(String),
        state: expect.any(String),
        labels: expect.any(Array),
        priority: expect.any(Number),
        url: expect.any(String),
      }),
    );
    expect(MOCK_ISSUE.labels.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.description).toContain("## Problem");
    expect(MOCK_ISSUE.description).toContain("## Acceptance Criteria");
  });
});

describe("MOCK_LINEAR_STATES", () => {
  it("exposes the expected set of state keys mapped to display names", () => {
    expect(MOCK_LINEAR_STATES).toEqual({
      todo: "Todo",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
      cancelled: "Cancelled",
    });
  });
});
