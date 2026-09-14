import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("mockLinearData", () => {
  describe("MOCK_ISSUE", () => {
    it("has the expected identity fields", () => {
      expect(MOCK_ISSUE.id).toBe("LIN-1042");
      expect(MOCK_ISSUE.identifier).toBe("LIN-1042");
      expect(MOCK_ISSUE.title).toBe("Add request validation middleware to API endpoints");
      expect(MOCK_ISSUE.branchName).toBe("mock/lin-1042-add-request-validation-middleware");
      expect(MOCK_ISSUE.state).toBe("Todo");
    });

    it("has a non-empty description describing the problem/requirements/acceptance criteria", () => {
      expect(typeof MOCK_ISSUE.description).toBe("string");
      expect(MOCK_ISSUE.description).toContain("## Problem");
      expect(MOCK_ISSUE.description).toContain("## Requirements");
      expect(MOCK_ISSUE.description).toContain("## Acceptance Criteria");
    });

    it("has labels, priority, url, project and cycle fields", () => {
      expect(MOCK_ISSUE.labels).toEqual(["bug", "api", "validation"]);
      expect(MOCK_ISSUE.priority).toBe(2);
      expect(MOCK_ISSUE.url).toBe("https://linear.app/mock-team/issue/LIN-1042");
      expect(MOCK_ISSUE.project).toBe("Backend Platform");
      expect(MOCK_ISSUE.cycle).toBe("Sprint 23");
    });
  });

  describe("MOCK_LINEAR_STATES", () => {
    it("maps each lifecycle stage to its Linear display name", () => {
      expect(MOCK_LINEAR_STATES).toEqual({
        todo: "Todo",
        inProgress: "In Progress",
        inReview: "In Review",
        done: "Done",
        cancelled: "Cancelled",
      });
    });
  });
});
