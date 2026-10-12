import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("mockGitHubData", () => {
  describe("MOCK_DIFF", () => {
    it("is a non-empty unified diff with file headers", () => {
      expect(typeof MOCK_DIFF).toBe("string");
      expect(MOCK_DIFF.length).toBeGreaterThan(0);
      expect(MOCK_DIFF).toContain("diff --git");
      expect(MOCK_DIFF).toContain("---");
      expect(MOCK_DIFF).toContain("+++");
    });

    it("contains hunk headers describing changed line ranges", () => {
      expect(MOCK_DIFF).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    });

    it("references the two files it claims to modify in the diff --git lines", () => {
      const gitLines = MOCK_DIFF.split("\n").filter((l) => l.startsWith("diff --git"));
      expect(gitLines.length).toBeGreaterThanOrEqual(2);
      expect(gitLines.some((l) => l.includes("validation.ts"))).toBe(true);
      expect(gitLines.some((l) => l.includes("users.ts"))).toBe(true);
    });
  });

  describe("MOCK_REPO_CONFIG", () => {
    it("has the expected required fields with correct types", () => {
      expect(typeof MOCK_REPO_CONFIG.name).toBe("string");
      expect(MOCK_REPO_CONFIG.name).toContain("/");
      expect(typeof MOCK_REPO_CONFIG.defaultBranch).toBe("string");
      expect(typeof MOCK_REPO_CONFIG.repoPath).toBe("string");
      expect(Array.isArray(MOCK_REPO_CONFIG.allowedPaths)).toBe(true);
      expect(Array.isArray(MOCK_REPO_CONFIG.protectedPaths)).toBe(true);
    });

    it("has non-overlapping allowed and protected paths", () => {
      const overlap = MOCK_REPO_CONFIG.allowedPaths.filter((p) =>
        MOCK_REPO_CONFIG.protectedPaths.includes(p),
      );
      expect(overlap).toHaveLength(0);
    });

    it("has at least one allowed and one protected path configured", () => {
      expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
      expect(MOCK_REPO_CONFIG.protectedPaths.length).toBeGreaterThan(0);
    });
  });
});
