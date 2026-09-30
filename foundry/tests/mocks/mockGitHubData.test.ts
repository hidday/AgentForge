import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("mockGitHubData", () => {
  describe("MOCK_DIFF", () => {
    it("is a non-empty unified diff string", () => {
      expect(typeof MOCK_DIFF).toBe("string");
      expect(MOCK_DIFF.length).toBeGreaterThan(0);
      expect(MOCK_DIFF).toContain("diff --git");
    });

    it("contains at least one added and one modified file header", () => {
      expect(MOCK_DIFF).toContain("new file mode");
      expect(MOCK_DIFF).toMatch(/--- \//);
      expect(MOCK_DIFF).toMatch(/\+\+\+ b\//);
    });
  });

  describe("MOCK_REPO_CONFIG", () => {
    it("has the expected shape and required fields", () => {
      expect(MOCK_REPO_CONFIG).toEqual(
        expect.objectContaining({
          name: expect.any(String),
          defaultBranch: expect.any(String),
          repoPath: expect.any(String),
          allowedPaths: expect.any(Array),
          protectedPaths: expect.any(Array),
        }),
      );
    });

    it("has non-empty allowedPaths and protectedPaths arrays", () => {
      expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
      expect(MOCK_REPO_CONFIG.protectedPaths.length).toBeGreaterThan(0);
    });

    it("does not list the same path in both allowedPaths and protectedPaths", () => {
      const overlap = MOCK_REPO_CONFIG.allowedPaths.filter((p) =>
        MOCK_REPO_CONFIG.protectedPaths.includes(p),
      );
      expect(overlap).toEqual([]);
    });
  });
});
