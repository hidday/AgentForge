import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("MOCK_DIFF", () => {
  it("is a non-empty unified diff string", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
  });

  it("contains valid 'diff --git' headers for each file touched", () => {
    const diffHeaders = MOCK_DIFF.match(/^diff --git a\/.+ b\/.+$/gm) ?? [];
    expect(diffHeaders.length).toBeGreaterThanOrEqual(2);
  });

  it("contains at least one hunk header", () => {
    expect(MOCK_DIFF).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@/m);
  });

  it("references the validation middleware file consistently", () => {
    expect(MOCK_DIFF).toContain("src/middleware/validation.ts");
  });
});

describe("MOCK_REPO_CONFIG", () => {
  it("has the expected shape with non-empty name, defaultBranch and repoPath", () => {
    expect(typeof MOCK_REPO_CONFIG.name).toBe("string");
    expect(MOCK_REPO_CONFIG.name.length).toBeGreaterThan(0);
    expect(typeof MOCK_REPO_CONFIG.defaultBranch).toBe("string");
    expect(typeof MOCK_REPO_CONFIG.repoPath).toBe("string");
  });

  it("has allowedPaths and protectedPaths as non-empty arrays of strings", () => {
    expect(Array.isArray(MOCK_REPO_CONFIG.allowedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
    for (const p of MOCK_REPO_CONFIG.allowedPaths) {
      expect(typeof p).toBe("string");
    }

    expect(Array.isArray(MOCK_REPO_CONFIG.protectedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.protectedPaths.length).toBeGreaterThan(0);
    for (const p of MOCK_REPO_CONFIG.protectedPaths) {
      expect(typeof p).toBe("string");
    }
  });

  it("does not have any path listed as both allowed and protected", () => {
    const overlap = MOCK_REPO_CONFIG.allowedPaths.filter((p) =>
      MOCK_REPO_CONFIG.protectedPaths.includes(p),
    );
    expect(overlap).toEqual([]);
  });

  it("has a repo name in 'owner/name' form", () => {
    expect(MOCK_REPO_CONFIG.name).toMatch(/^[\w.-]+\/[\w.-]+$/);
  });
});
