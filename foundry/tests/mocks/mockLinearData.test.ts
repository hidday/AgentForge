import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("mockLinearData", () => {
  it("MOCK_ISSUE has the expected LinearIssue shape", () => {
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
    });
    expect(MOCK_ISSUE.description.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.labels.length).toBeGreaterThan(0);
  });

  it("MOCK_LINEAR_STATES enumerates the known Linear workflow states", () => {
    expect(MOCK_LINEAR_STATES).toEqual({
      todo: "Todo",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
      cancelled: "Cancelled",
    });
  });
});
