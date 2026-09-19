import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("MOCK_DIFF", () => {
  it("is a non-empty unified diff string with the expected file headers", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
    expect(MOCK_DIFF).toContain("diff --git a/src/middleware/validation.ts");
    expect(MOCK_DIFF).toContain("diff --git a/src/routes/users.ts");
  });

  it("contains balanced diff hunk headers for both files it touches", () => {
    const hunkHeaders = MOCK_DIFF.match(/^@@ .* @@$/gm) ?? [];
    expect(hunkHeaders.length).toBeGreaterThanOrEqual(2);
  });
});

describe("MOCK_REPO_CONFIG", () => {
  it("has the shape expected by RepoConfig consumers", () => {
    expect(MOCK_REPO_CONFIG).toEqual({
      name: "acme/backend-api",
      defaultBranch: "main",
      repoPath: "./workspace",
      allowedPaths: expect.any(Array),
      protectedPaths: expect.any(Array),
    });
  });

  it("has non-empty allowedPaths and protectedPaths arrays of strings", () => {
    expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
    expect(MOCK_REPO_CONFIG.protectedPaths.length).toBeGreaterThan(0);
    for (const p of MOCK_REPO_CONFIG.allowedPaths) expect(typeof p).toBe("string");
    for (const p of MOCK_REPO_CONFIG.protectedPaths) expect(typeof p).toBe("string");
  });
});
