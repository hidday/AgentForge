import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("mockGitHubData", () => {
  it("MOCK_DIFF is a non-empty unified diff string", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
    expect(MOCK_DIFF).toContain("diff --git");
  });

  it("MOCK_REPO_CONFIG has the expected shape", () => {
    expect(MOCK_REPO_CONFIG).toMatchObject({
      name: expect.any(String),
      defaultBranch: expect.any(String),
      repoPath: expect.any(String),
      allowedPaths: expect.any(Array),
      protectedPaths: expect.any(Array),
    });
    expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
    expect(MOCK_REPO_CONFIG.protectedPaths.length).toBeGreaterThan(0);
  });
});
