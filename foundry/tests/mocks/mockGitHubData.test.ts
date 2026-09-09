import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("mockGitHubData", () => {
  it("MOCK_DIFF is a non-empty unified diff", () => {
    expect(MOCK_DIFF).toContain("diff --git a/src/middleware/validation.ts");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
  });

  it("MOCK_REPO_CONFIG has the expected shape", () => {
    expect(MOCK_REPO_CONFIG).toEqual({
      name: "acme/backend-api",
      defaultBranch: "main",
      repoPath: "./workspace",
      allowedPaths: ["src/", "tests/", "package.json"],
      protectedPaths: [".github/", "infrastructure/", "prisma/migrations/"],
    });
  });
});
