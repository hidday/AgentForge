import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("mockGitHubData fixtures", () => {
  it("MOCK_DIFF looks like a unified git diff", () => {
    expect(MOCK_DIFF).toContain("diff --git");
    expect(MOCK_DIFF).toContain("@@");
  });

  it("MOCK_REPO_CONFIG has the shape expected by RepoConfig consumers", () => {
    expect(MOCK_REPO_CONFIG).toMatchObject({
      name: "acme/backend-api",
      defaultBranch: "main",
    });
    expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
    expect(MOCK_REPO_CONFIG.protectedPaths.length).toBeGreaterThan(0);
  });
});

describe("mockLinearData fixtures", () => {
  it("MOCK_ISSUE satisfies the LinearIssue shape with non-empty required fields", () => {
    expect(MOCK_ISSUE.id).toBeTruthy();
    expect(MOCK_ISSUE.title).toBeTruthy();
    expect(MOCK_ISSUE.branchName).toBeTruthy();
    expect(MOCK_ISSUE.labels.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.state).toBe(MOCK_LINEAR_STATES.todo);
  });

  it("MOCK_LINEAR_STATES enumerates the standard Linear workflow states", () => {
    expect(Object.values(MOCK_LINEAR_STATES)).toEqual([
      "Todo",
      "In Progress",
      "In Review",
      "Done",
      "Cancelled",
    ]);
  });
});
