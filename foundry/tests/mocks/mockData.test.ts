import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("mockGitHubData", () => {
  it("MOCK_DIFF looks like a unified diff", () => {
    expect(MOCK_DIFF).toContain("diff --git");
    expect(MOCK_DIFF).toContain("@@");
  });

  it("MOCK_REPO_CONFIG has the shape of a repo config", () => {
    expect(MOCK_REPO_CONFIG.name).toBe("acme/backend-api");
    expect(MOCK_REPO_CONFIG.allowedPaths).toContain("src/");
    expect(MOCK_REPO_CONFIG.protectedPaths).toContain(".github/");
  });
});

describe("mockLinearData", () => {
  it("MOCK_ISSUE has the shape of a LinearIssue", () => {
    expect(MOCK_ISSUE.id).toBe("LIN-1042");
    expect(MOCK_ISSUE.labels).toContain("api");
    expect(MOCK_ISSUE.priority).toBeGreaterThanOrEqual(0);
  });

  it("MOCK_LINEAR_STATES maps every known workflow state", () => {
    expect(MOCK_LINEAR_STATES.todo).toBe("Todo");
    expect(MOCK_LINEAR_STATES.done).toBe("Done");
    expect(Object.keys(MOCK_LINEAR_STATES)).toHaveLength(5);
  });
});
