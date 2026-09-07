import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("mockLinearData", () => {
  it("MOCK_ISSUE has the shape of a valid LinearIssue with non-empty description", () => {
    expect(MOCK_ISSUE.id).toBe("LIN-1042");
    expect(MOCK_ISSUE.title.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.description).toContain("Requirements");
    expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
    expect(MOCK_ISSUE.labels.length).toBeGreaterThan(0);
    expect(typeof MOCK_ISSUE.priority).toBe("number");
  });

  it("MOCK_LINEAR_STATES exposes the expected workflow state names", () => {
    expect(MOCK_LINEAR_STATES).toEqual({
      todo: "Todo",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
      cancelled: "Cancelled",
    });
  });
});

describe("mockGitHubData", () => {
  it("MOCK_DIFF is a non-empty unified diff containing file headers", () => {
    expect(MOCK_DIFF).toContain("diff --git");
    expect(MOCK_DIFF).toContain("+++ b/");
    expect(MOCK_DIFF.length).toBeGreaterThan(100);
  });

  it("MOCK_REPO_CONFIG has the shape of a valid repo config", () => {
    expect(MOCK_REPO_CONFIG.name).toBe("acme/backend-api");
    expect(MOCK_REPO_CONFIG.defaultBranch).toBe("main");
    expect(Array.isArray(MOCK_REPO_CONFIG.allowedPaths)).toBe(true);
    expect(Array.isArray(MOCK_REPO_CONFIG.protectedPaths)).toBe(true);
  });
});
