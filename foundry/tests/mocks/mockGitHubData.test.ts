import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("mockGitHubData", () => {
  describe("MOCK_DIFF", () => {
    it("is a non-empty unified diff string with the expected file headers", () => {
      expect(typeof MOCK_DIFF).toBe("string");
      expect(MOCK_DIFF.length).toBeGreaterThan(0);
      expect(MOCK_DIFF).toContain("diff --git a/src/middleware/validation.ts");
      expect(MOCK_DIFF).toContain("diff --git a/src/routes/users.ts");
      expect(MOCK_DIFF).toContain("+++ b/src/middleware/validation.ts");
    });
  });

  describe("MOCK_REPO_CONFIG", () => {
    it("has the expected repo identity and branch fields", () => {
      expect(MOCK_REPO_CONFIG.name).toBe("acme/backend-api");
      expect(MOCK_REPO_CONFIG.defaultBranch).toBe("main");
      expect(MOCK_REPO_CONFIG.repoPath).toBe("./workspace");
    });

    it("has allowedPaths and protectedPaths arrays with the expected entries", () => {
      expect(MOCK_REPO_CONFIG.allowedPaths).toEqual(["src/", "tests/", "package.json"]);
      expect(MOCK_REPO_CONFIG.protectedPaths).toEqual([
        ".github/",
        "infrastructure/",
        "prisma/migrations/",
      ]);
    });
  });
});
