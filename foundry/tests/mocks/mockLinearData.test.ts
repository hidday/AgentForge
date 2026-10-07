import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("mockLinearData fixtures", () => {
  it("MOCK_ISSUE has a complete, well-formed shape", () => {
    expect(MOCK_ISSUE.identifier).toBe("LIN-1042");
    expect(MOCK_ISSUE.labels.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.description).toContain("Acceptance Criteria");
  });

  it("MOCK_LINEAR_STATES covers the standard workflow states", () => {
    expect(MOCK_LINEAR_STATES.todo).toBe("Todo");
    expect(MOCK_LINEAR_STATES.done).toBe("Done");
    expect(Object.keys(MOCK_LINEAR_STATES)).toEqual([
      "todo",
      "inProgress",
      "inReview",
      "done",
      "cancelled",
    ]);
  });
});
