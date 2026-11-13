import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("MOCK_DIFF", () => {
  it("is a non-empty unified diff string", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
    expect(MOCK_DIFF).toContain("diff --git");
  });
});

describe("MOCK_REPO_CONFIG", () => {
  it("has the expected shape and fields", () => {
    expect(MOCK_REPO_CONFIG).toMatchObject({
      name: expect.any(String),
      defaultBranch: expect.any(String),
      repoPath: expect.any(String),
      allowedPaths: expect.any(Array),
      protectedPaths: expect.any(Array),
    });
  });

  it("has non-empty allowedPaths and protectedPaths arrays of strings", () => {
    expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
    expect(MOCK_REPO_CONFIG.protectedPaths.length).toBeGreaterThan(0);
    for (const p of MOCK_REPO_CONFIG.allowedPaths) {
      expect(typeof p).toBe("string");
    }
    for (const p of MOCK_REPO_CONFIG.protectedPaths) {
      expect(typeof p).toBe("string");
    }
  });
});
