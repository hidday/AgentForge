import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("mockGitHubData fixtures", () => {
  it("MOCK_DIFF is a non-empty unified diff referencing at least one changed file", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF).toContain("diff --git");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
  });

  it("MOCK_REPO_CONFIG has the shape expected by TaskBundle.repo", () => {
    expect(MOCK_REPO_CONFIG.name).toBe("acme/backend-api");
    expect(MOCK_REPO_CONFIG.defaultBranch).toBe("main");
    expect(Array.isArray(MOCK_REPO_CONFIG.allowedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
    expect(Array.isArray(MOCK_REPO_CONFIG.protectedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.protectedPaths).toContain(".github/");
  });
});

describe("mockLinearData fixtures", () => {
  it("MOCK_ISSUE has the shape expected by LinearIssue", () => {
    expect(MOCK_ISSUE.id).toBe("LIN-1042");
    expect(MOCK_ISSUE.identifier).toBe("LIN-1042");
    expect(typeof MOCK_ISSUE.title).toBe("string");
    expect(typeof MOCK_ISSUE.description).toBe("string");
    expect(MOCK_ISSUE.labels).toContain("api");
    expect(MOCK_ISSUE.priority).toBe(2);
    expect(MOCK_ISSUE.url).toContain("linear.app");
  });

  it("MOCK_LINEAR_STATES enumerates the Linear workflow states by key", () => {
    expect(MOCK_LINEAR_STATES.todo).toBe("Todo");
    expect(MOCK_LINEAR_STATES.inProgress).toBe("In Progress");
    expect(MOCK_LINEAR_STATES.inReview).toBe("In Review");
    expect(MOCK_LINEAR_STATES.done).toBe("Done");
    expect(MOCK_LINEAR_STATES.cancelled).toBe("Cancelled");
    expect(Object.keys(MOCK_LINEAR_STATES)).toHaveLength(5);
  });
});
