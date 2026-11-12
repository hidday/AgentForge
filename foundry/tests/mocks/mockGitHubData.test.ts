import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("mockGitHubData", () => {
  it("MOCK_DIFF is a non-empty unified diff with file headers", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
    expect(MOCK_DIFF).toContain("diff --git");
    expect(MOCK_DIFF).toContain("+++ b/");
  });

  it("MOCK_REPO_CONFIG has the shape RealGitHubClient/RepoRegistry consumers expect", () => {
    expect(MOCK_REPO_CONFIG).toEqual({
      name: "acme/backend-api",
      defaultBranch: "main",
      repoPath: "./workspace",
      allowedPaths: ["src/", "tests/", "package.json"],
      protectedPaths: [".github/", "infrastructure/", "prisma/migrations/"],
    });
  });
});
