import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("MOCK_DIFF", () => {
  it("is a non-empty unified diff string with file headers and hunks", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
    expect(MOCK_DIFF).toContain("diff --git");
    expect(MOCK_DIFF).toContain("@@");
    expect(MOCK_DIFF).toContain("+++ b/");
  });

  it("contains at least one added and one context/removed-style line", () => {
    const lines = MOCK_DIFF.split("\n");
    expect(lines.some((l) => l.startsWith("+"))).toBe(true);
  });
});

describe("MOCK_REPO_CONFIG", () => {
  it("has the expected required repo config fields with correct types", () => {
    expect(typeof MOCK_REPO_CONFIG.name).toBe("string");
    expect(MOCK_REPO_CONFIG.name.length).toBeGreaterThan(0);
    expect(typeof MOCK_REPO_CONFIG.defaultBranch).toBe("string");
    expect(typeof MOCK_REPO_CONFIG.repoPath).toBe("string");
    expect(Array.isArray(MOCK_REPO_CONFIG.allowedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
    expect(Array.isArray(MOCK_REPO_CONFIG.protectedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.protectedPaths.length).toBeGreaterThan(0);
  });

  it("every allowedPaths and protectedPaths entry is a non-empty string", () => {
    for (const p of [...MOCK_REPO_CONFIG.allowedPaths, ...MOCK_REPO_CONFIG.protectedPaths]) {
      expect(typeof p).toBe("string");
      expect(p.length).toBeGreaterThan(0);
    }
  });
});
