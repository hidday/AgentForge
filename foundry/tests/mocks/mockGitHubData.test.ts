import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("mockGitHubData", () => {
  it("MOCK_DIFF is a non-empty unified diff", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF).toContain("diff --git");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
  });

  it("MOCK_REPO_CONFIG has the shape of a repo configuration", () => {
    expect(MOCK_REPO_CONFIG).toMatchObject({
      name: "acme/backend-api",
      defaultBranch: "main",
      repoPath: "./workspace",
    });
    expect(MOCK_REPO_CONFIG.allowedPaths).toContain("src/");
    expect(MOCK_REPO_CONFIG.protectedPaths.length).toBeGreaterThan(0);
  });
});
