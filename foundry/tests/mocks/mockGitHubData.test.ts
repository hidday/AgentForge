import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("MOCK_DIFF", () => {
  it("is a non-empty unified diff string starting with a git diff header", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
    expect(MOCK_DIFF.startsWith("diff --git")).toBe(true);
  });

  it("contains hunk headers and additions for the files it describes", () => {
    expect(MOCK_DIFF).toContain("src/middleware/validation.ts");
    expect(MOCK_DIFF).toContain("src/routes/users.ts");
    expect(MOCK_DIFF).toMatch(/@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/);
    expect(MOCK_DIFF).toContain("+export function validateBody");
  });
});

describe("MOCK_REPO_CONFIG", () => {
  it("has the expected repo identity and branch fields", () => {
    expect(MOCK_REPO_CONFIG.name).toBe("acme/backend-api");
    expect(MOCK_REPO_CONFIG.defaultBranch).toBe("main");
    expect(MOCK_REPO_CONFIG.repoPath).toBe("./workspace");
  });

  it("has allowedPaths and protectedPaths as string arrays with the expected entries", () => {
    expect(Array.isArray(MOCK_REPO_CONFIG.allowedPaths)).toBe(true);
    expect(Array.isArray(MOCK_REPO_CONFIG.protectedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.allowedPaths).toEqual(
      expect.arrayContaining(["src/", "tests/", "package.json"]),
    );
    expect(MOCK_REPO_CONFIG.protectedPaths).toEqual(
      expect.arrayContaining([".github/", "infrastructure/", "prisma/migrations/"]),
    );
    for (const p of [...MOCK_REPO_CONFIG.allowedPaths, ...MOCK_REPO_CONFIG.protectedPaths]) {
      expect(typeof p).toBe("string");
    }
  });
});
