import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("mockLinearData", () => {
  describe("MOCK_ISSUE", () => {
    it("has the expected id and identifier", () => {
      expect(MOCK_ISSUE.id).toBe("LIN-1042");
      expect(MOCK_ISSUE.identifier).toBe("LIN-1042");
    });

    it("has a title, state, priority, and non-empty labels/description", () => {
      expect(MOCK_ISSUE.title).toBe("Add request validation middleware to API endpoints");
      expect(MOCK_ISSUE.state).toBe("Todo");
      expect(MOCK_ISSUE.priority).toBe(2);
      expect(MOCK_ISSUE.labels).toEqual(["bug", "api", "validation"]);
      expect(MOCK_ISSUE.description.length).toBeGreaterThan(0);
      expect(MOCK_ISSUE.description).toContain("## Requirements");
    });

    it("has a branch name derived from its identifier", () => {
      expect(MOCK_ISSUE.branchName).toBe("mock/lin-1042-add-request-validation-middleware");
    });
  });

  describe("MOCK_LINEAR_STATES", () => {
    it("maps each lifecycle key to its display state string", () => {
      expect(MOCK_LINEAR_STATES.todo).toBe("Todo");
      expect(MOCK_LINEAR_STATES.inProgress).toBe("In Progress");
      expect(MOCK_LINEAR_STATES.inReview).toBe("In Review");
      expect(MOCK_LINEAR_STATES.done).toBe("Done");
      expect(MOCK_LINEAR_STATES.cancelled).toBe("Cancelled");
    });
  });
});
