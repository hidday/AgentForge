import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("MOCK_DIFF", () => {
  it("is a well-formed unified diff string with file headers and hunks", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF).toContain("diff --git");
    expect(MOCK_DIFF).toContain("--- ");
    expect(MOCK_DIFF).toContain("+++ ");
    expect(MOCK_DIFF).toMatch(/@@ -\d+(,\d+)? \+\d+(,\d+)? @@/);
  });

  it("references at least one added and one existing file path", () => {
    expect(MOCK_DIFF).toContain("src/middleware/validation.ts");
    expect(MOCK_DIFF).toContain("src/routes/users.ts");
  });
});

describe("MOCK_REPO_CONFIG", () => {
  it("has the shape of a repo config with non-empty required fields", () => {
    expect(typeof MOCK_REPO_CONFIG.name).toBe("string");
    expect(MOCK_REPO_CONFIG.name.length).toBeGreaterThan(0);
    expect(typeof MOCK_REPO_CONFIG.defaultBranch).toBe("string");
    expect(typeof MOCK_REPO_CONFIG.repoPath).toBe("string");
    expect(Array.isArray(MOCK_REPO_CONFIG.allowedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
    expect(Array.isArray(MOCK_REPO_CONFIG.protectedPaths)).toBe(true);
  });

  it("does not overlap allowed and protected paths", () => {
    const overlap = MOCK_REPO_CONFIG.allowedPaths.filter((p) =>
      MOCK_REPO_CONFIG.protectedPaths.includes(p),
    );
    expect(overlap).toEqual([]);
  });
});
