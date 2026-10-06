import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("MOCK_DIFF", () => {
  it("is a non-empty unified diff with git diff headers for each file", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
    expect(MOCK_DIFF).toContain("diff --git a/src/middleware/validation.ts");
    expect(MOCK_DIFF).toContain("diff --git a/src/routes/users.ts");
  });

  it("contains valid hunk headers for each changed file", () => {
    const hunkHeaders = MOCK_DIFF.match(/^@@ .* @@$/gm) ?? [];
    expect(hunkHeaders.length).toBeGreaterThanOrEqual(2);
  });

  it("marks the validation middleware file as newly created", () => {
    expect(MOCK_DIFF).toContain("new file mode 100644");
    expect(MOCK_DIFF).toContain("--- /dev/null");
    expect(MOCK_DIFF).toContain("+++ b/src/middleware/validation.ts");
  });
});

describe("MOCK_REPO_CONFIG", () => {
  it("has the expected shape with name, defaultBranch, repoPath, and path arrays", () => {
    expect(MOCK_REPO_CONFIG).toMatchObject({
      name: "acme/backend-api",
      defaultBranch: "main",
      repoPath: "./workspace",
    });
    expect(Array.isArray(MOCK_REPO_CONFIG.allowedPaths)).toBe(true);
    expect(Array.isArray(MOCK_REPO_CONFIG.protectedPaths)).toBe(true);
  });

  it("includes src/ and tests/ in allowedPaths and infra-sensitive dirs in protectedPaths", () => {
    expect(MOCK_REPO_CONFIG.allowedPaths).toEqual(
      expect.arrayContaining(["src/", "tests/", "package.json"]),
    );
    expect(MOCK_REPO_CONFIG.protectedPaths).toEqual(
      expect.arrayContaining([".github/", "infrastructure/", "prisma/migrations/"]),
    );
  });

  it("has no overlap between allowedPaths and protectedPaths", () => {
    const overlap = MOCK_REPO_CONFIG.allowedPaths.filter((p) =>
      MOCK_REPO_CONFIG.protectedPaths.includes(p),
    );
    expect(overlap).toEqual([]);
  });
});
