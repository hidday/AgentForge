import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("MOCK_DIFF", () => {
  it("is a non-empty unified diff string", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
    expect(MOCK_DIFF).toContain("diff --git");
  });

  it("references files consistent with a validation-middleware change", () => {
    expect(MOCK_DIFF).toContain("src/middleware/validation.ts");
    expect(MOCK_DIFF).toContain("src/routes/users.ts");
  });
});

describe("MOCK_REPO_CONFIG", () => {
  it("has the required RepoConfig-shaped fields with correct types", () => {
    expect(typeof MOCK_REPO_CONFIG.name).toBe("string");
    expect(typeof MOCK_REPO_CONFIG.defaultBranch).toBe("string");
    expect(typeof MOCK_REPO_CONFIG.repoPath).toBe("string");
    expect(Array.isArray(MOCK_REPO_CONFIG.allowedPaths)).toBe(true);
    expect(Array.isArray(MOCK_REPO_CONFIG.protectedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.allowedPaths.every((p) => typeof p === "string")).toBe(true);
    expect(MOCK_REPO_CONFIG.protectedPaths.every((p) => typeof p === "string")).toBe(true);
  });

  it("has non-empty name, defaultBranch, and repoPath", () => {
    expect(MOCK_REPO_CONFIG.name.length).toBeGreaterThan(0);
    expect(MOCK_REPO_CONFIG.defaultBranch.length).toBeGreaterThan(0);
    expect(MOCK_REPO_CONFIG.repoPath.length).toBeGreaterThan(0);
  });
});
