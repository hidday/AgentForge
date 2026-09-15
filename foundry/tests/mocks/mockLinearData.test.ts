import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("MOCK_ISSUE", () => {
  it("exposes a well-formed LinearIssue fixture", () => {
    expect(MOCK_ISSUE.id).toBe("LIN-1042");
    expect(MOCK_ISSUE.identifier).toBe("LIN-1042");
    expect(MOCK_ISSUE.title).toContain("request validation middleware");
    expect(MOCK_ISSUE.branchName).toBe("mock/lin-1042-add-request-validation-middleware");
    expect(MOCK_ISSUE.state).toBe("Todo");
    expect(MOCK_ISSUE.priority).toBe(2);
    expect(MOCK_ISSUE.url).toBe("https://linear.app/mock-team/issue/LIN-1042");
    expect(MOCK_ISSUE.project).toBe("Backend Platform");
    expect(MOCK_ISSUE.cycle).toBe("Sprint 23");
  });

  it("has a non-empty labels array of strings", () => {
    expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
    expect(MOCK_ISSUE.labels.length).toBeGreaterThan(0);
    for (const label of MOCK_ISSUE.labels) {
      expect(typeof label).toBe("string");
    }
    expect(MOCK_ISSUE.labels).toEqual(["bug", "api", "validation"]);
  });

  it("builds description as newline-joined markdown containing the expected sections", () => {
    expect(MOCK_ISSUE.description).toContain("## Problem");
    expect(MOCK_ISSUE.description).toContain("## Requirements");
    expect(MOCK_ISSUE.description).toContain("## Acceptance Criteria");
    expect(MOCK_ISSUE.description.includes("\n")).toBe(true);
    // Every line came from the array-join, so there should be no literal "\n" escape sequences.
    expect(MOCK_ISSUE.description).not.toContain("\\n");
  });
});

describe("MOCK_LINEAR_STATES", () => {
  it("maps each known workflow state key to its display label", () => {
    expect(MOCK_LINEAR_STATES.todo).toBe("Todo");
    expect(MOCK_LINEAR_STATES.inProgress).toBe("In Progress");
    expect(MOCK_LINEAR_STATES.inReview).toBe("In Review");
    expect(MOCK_LINEAR_STATES.done).toBe("Done");
    expect(MOCK_LINEAR_STATES.cancelled).toBe("Cancelled");
  });

  it("exposes exactly the five known states, no more and no fewer", () => {
    expect(Object.keys(MOCK_LINEAR_STATES).sort()).toEqual(
      ["cancelled", "done", "inProgress", "inReview", "todo"].sort(),
    );
  });
});
