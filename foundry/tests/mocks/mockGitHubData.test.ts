import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("MOCK_DIFF fixture", () => {
  it("is a non-empty unified diff string", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
    expect(MOCK_DIFF).toContain("diff --git");
    expect(MOCK_DIFF).toContain("+++ ");
    expect(MOCK_DIFF).toContain("--- ");
  });
});

describe("MOCK_REPO_CONFIG fixture", () => {
  it("has the expected repo-config shape", () => {
    expect(typeof MOCK_REPO_CONFIG.name).toBe("string");
    expect(MOCK_REPO_CONFIG.name.length).toBeGreaterThan(0);
    expect(typeof MOCK_REPO_CONFIG.defaultBranch).toBe("string");
    expect(Array.isArray(MOCK_REPO_CONFIG.allowedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
    expect(Array.isArray(MOCK_REPO_CONFIG.protectedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.protectedPaths.length).toBeGreaterThan(0);
  });
});
