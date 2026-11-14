import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";
import { RepoConfigSchema } from "../../src/schemas/taskBundle.js";

describe("mockLinearData fixtures", () => {
  it("MOCK_ISSUE has the shape expected by LinearIssue consumers", () => {
    expect(MOCK_ISSUE.id).toBeTruthy();
    expect(MOCK_ISSUE.identifier).toBeTruthy();
    expect(typeof MOCK_ISSUE.title).toBe("string");
    expect(typeof MOCK_ISSUE.description).toBe("string");
    expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
    expect(MOCK_ISSUE.priority).toBeGreaterThanOrEqual(0);
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

describe("mockGitHubData fixtures", () => {
  it("MOCK_DIFF is a well-formed unified diff", () => {
    expect(MOCK_DIFF).toContain("diff --git");
    expect(MOCK_DIFF).toContain("+++ b/");
  });

  it("MOCK_REPO_CONFIG satisfies the RepoConfig schema shape", () => {
    const result = RepoConfigSchema.safeParse({
      ...MOCK_REPO_CONFIG,
      workingBranch: "mock/branch",
    });
    expect(result.success).toBe(true);
  });
});
