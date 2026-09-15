import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("MOCK_ISSUE", () => {
  it("matches the LinearIssue shape", () => {
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

  it("has a non-empty description and at least one label", () => {
    expect(MOCK_ISSUE.description.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.labels.length).toBeGreaterThan(0);
  });
});

describe("MOCK_LINEAR_STATES", () => {
  it("has all 5 expected keys", () => {
    expect(Object.keys(MOCK_LINEAR_STATES).sort()).toEqual(
      ["cancelled", "done", "inProgress", "inReview", "todo"].sort(),
    );
  });

  it("maps each key to a non-empty string", () => {
    for (const value of Object.values(MOCK_LINEAR_STATES)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
