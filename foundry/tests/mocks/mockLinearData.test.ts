import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("MOCK_ISSUE", () => {
  it("has all the fields required by the LinearIssue shape", () => {
    expect(MOCK_ISSUE.id).toBe("LIN-1042");
    expect(MOCK_ISSUE.identifier).toBe("LIN-1042");
    expect(typeof MOCK_ISSUE.title).toBe("string");
    expect(MOCK_ISSUE.title.length).toBeGreaterThan(0);
    expect(typeof MOCK_ISSUE.branchName).toBe("string");
    expect(typeof MOCK_ISSUE.description).toBe("string");
    expect(MOCK_ISSUE.state).toBe("Todo");
    expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
    expect(MOCK_ISSUE.labels.length).toBeGreaterThan(0);
    expect(typeof MOCK_ISSUE.priority).toBe("number");
    expect(MOCK_ISSUE.url).toMatch(/^https:\/\//);
    expect(MOCK_ISSUE.project).toBe("Backend Platform");
    expect(MOCK_ISSUE.cycle).toBe("Sprint 23");
  });

  it("has a description containing the expected markdown sections", () => {
    expect(MOCK_ISSUE.description).toContain("## Problem");
    expect(MOCK_ISSUE.description).toContain("## Requirements");
    expect(MOCK_ISSUE.description).toContain("## Acceptance Criteria");
  });

  it("has a branch name derived from the issue identifier", () => {
    expect(MOCK_ISSUE.branchName?.toLowerCase()).toContain("lin-1042");
  });
});

describe("MOCK_LINEAR_STATES", () => {
  it("maps each lifecycle stage to its display label", () => {
    expect(MOCK_LINEAR_STATES).toEqual({
      todo: "Todo",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
      cancelled: "Cancelled",
    });
  });

  it("is readonly at the type level (const assertion)", () => {
    // Runtime sanity check that the object has exactly the five expected keys.
    expect(Object.keys(MOCK_LINEAR_STATES).sort()).toEqual(
      ["cancelled", "done", "inProgress", "inReview", "todo"].sort(),
    );
  });
});
