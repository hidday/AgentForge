import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("MOCK_DIFF", () => {
  it("is a non-empty unified diff string", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
    expect(MOCK_DIFF).toContain("diff --git");
    expect(MOCK_DIFF).toContain("+++ b/");
    expect(MOCK_DIFF).toContain("--- a/");
  });
});

describe("MOCK_REPO_CONFIG", () => {
  it("has the shape of a repo config with array path fields", () => {
    expect(MOCK_REPO_CONFIG).toEqual(
      expect.objectContaining({
        name: expect.any(String),
        defaultBranch: expect.any(String),
        repoPath: expect.any(String),
        allowedPaths: expect.any(Array),
        protectedPaths: expect.any(Array),
      }),
    );
    expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
    expect(MOCK_REPO_CONFIG.protectedPaths.length).toBeGreaterThan(0);
  });
});
