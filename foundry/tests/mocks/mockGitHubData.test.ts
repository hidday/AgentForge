import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("mockGitHubData", () => {
  describe("MOCK_DIFF", () => {
    it("is a non-empty unified diff string", () => {
      expect(typeof MOCK_DIFF).toBe("string");
      expect(MOCK_DIFF.length).toBeGreaterThan(0);
      expect(MOCK_DIFF).toContain("diff --git");
    });

    it("includes both a new file and a modified file hunk", () => {
      expect(MOCK_DIFF).toContain("new file mode");
      expect(MOCK_DIFF).toContain("src/middleware/validation.ts");
      expect(MOCK_DIFF).toContain("src/routes/users.ts");
      expect(MOCK_DIFF).toContain("@@");
    });
  });

  describe("MOCK_REPO_CONFIG", () => {
    it("has the expected shape with name, branches, and path arrays", () => {
      expect(MOCK_REPO_CONFIG).toEqual({
        name: "acme/backend-api",
        defaultBranch: "main",
        repoPath: "./workspace",
        allowedPaths: ["src/", "tests/", "package.json"],
        protectedPaths: [".github/", "infrastructure/", "prisma/migrations/"],
      });
    });

    it("has non-overlapping allowed and protected top-level markers", () => {
      for (const protectedPath of MOCK_REPO_CONFIG.protectedPaths) {
        expect(MOCK_REPO_CONFIG.allowedPaths).not.toContain(protectedPath);
      }
    });
  });
});
