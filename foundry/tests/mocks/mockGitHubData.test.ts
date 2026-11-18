import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("mockGitHubData", () => {
  it("MOCK_DIFF looks like a unified git diff", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF).toContain("diff --git");
    expect(MOCK_DIFF).toContain("+++ b/src/middleware/validation.ts");
    expect(MOCK_DIFF).toContain("@@");
  });

  it("MOCK_REPO_CONFIG has the shape of a repo config", () => {
    expect(MOCK_REPO_CONFIG).toEqual({
      name: "acme/backend-api",
      defaultBranch: "main",
      repoPath: "./workspace",
      allowedPaths: ["src/", "tests/", "package.json"],
      protectedPaths: [".github/", "infrastructure/", "prisma/migrations/"],
    });
  });
});
