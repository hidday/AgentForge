import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("MOCK_ISSUE", () => {
  it("has the expected LinearIssue shape and fields", () => {
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

  it("has a non-empty description and labels array", () => {
    expect(MOCK_ISSUE.description.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.labels.length).toBeGreaterThan(0);
  });
});

describe("MOCK_LINEAR_STATES", () => {
  it("defines the expected set of workflow state names", () => {
    expect(MOCK_LINEAR_STATES).toEqual({
      todo: "Todo",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
      cancelled: "Cancelled",
    });
  });
});
