import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("mockGitHubData", () => {
  it("MOCK_DIFF is a non-empty unified diff string", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
    expect(MOCK_DIFF).toContain("diff --git");
    expect(MOCK_DIFF).toContain("+++");
    expect(MOCK_DIFF).toContain("---");
  });

  it("MOCK_REPO_CONFIG has the required RepoConfig-shaped fields", () => {
    expect(typeof MOCK_REPO_CONFIG.name).toBe("string");
    expect(MOCK_REPO_CONFIG.name.length).toBeGreaterThan(0);
    expect(typeof MOCK_REPO_CONFIG.defaultBranch).toBe("string");
    expect(typeof MOCK_REPO_CONFIG.repoPath).toBe("string");
    expect(Array.isArray(MOCK_REPO_CONFIG.allowedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
    expect(Array.isArray(MOCK_REPO_CONFIG.protectedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.protectedPaths.length).toBeGreaterThan(0);
  });
});

describe("mockLinearData", () => {
  it("MOCK_ISSUE has the required LinearIssue-shaped fields, well-formed", () => {
    expect(typeof MOCK_ISSUE.id).toBe("string");
    expect(MOCK_ISSUE.id.length).toBeGreaterThan(0);
    expect(typeof MOCK_ISSUE.identifier).toBe("string");
    expect(typeof MOCK_ISSUE.title).toBe("string");
    expect(MOCK_ISSUE.title.length).toBeGreaterThan(0);
    expect(typeof MOCK_ISSUE.branchName).toBe("string");
    expect(typeof MOCK_ISSUE.description).toBe("string");
    expect(MOCK_ISSUE.description.length).toBeGreaterThan(0);
    expect(typeof MOCK_ISSUE.state).toBe("string");
    expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
    expect(typeof MOCK_ISSUE.priority).toBe("number");
    expect(MOCK_ISSUE.priority).toBeGreaterThanOrEqual(0);
    expect(typeof MOCK_ISSUE.url).toBe("string");
    expect(MOCK_ISSUE.url).toMatch(/^https?:\/\//);
  });

  it("MOCK_LINEAR_STATES contains the expected Linear workflow state labels", () => {
    expect(MOCK_LINEAR_STATES).toEqual({
      todo: "Todo",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
      cancelled: "Cancelled",
    });
    // Every value should be a non-empty string.
    for (const value of Object.values(MOCK_LINEAR_STATES)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
