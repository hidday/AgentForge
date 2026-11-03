import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("MOCK_DIFF", () => {
  it("is a non-empty unified diff string", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
  });

  it("contains diff headers for both files it touches", () => {
    expect(MOCK_DIFF).toContain("diff --git a/src/middleware/validation.ts b/src/middleware/validation.ts");
    expect(MOCK_DIFF).toContain("diff --git a/src/routes/users.ts b/src/routes/users.ts");
  });

  it("marks the validation middleware file as newly created", () => {
    expect(MOCK_DIFF).toContain("new file mode 100644");
    expect(MOCK_DIFF).toContain("--- /dev/null");
  });

  it("contains hunk headers for both changed files", () => {
    const hunkHeaders = MOCK_DIFF.match(/^@@ .* @@/gm) ?? [];
    expect(hunkHeaders.length).toBe(2);
  });
});

describe("MOCK_REPO_CONFIG", () => {
  it("has the expected shape and field values", () => {
    expect(MOCK_REPO_CONFIG).toEqual({
      name: "acme/backend-api",
      defaultBranch: "main",
      repoPath: "./workspace",
      allowedPaths: ["src/", "tests/", "package.json"],
      protectedPaths: [".github/", "infrastructure/", "prisma/migrations/"],
    });
  });

  it("keeps allowedPaths and protectedPaths disjoint", () => {
    const overlap = MOCK_REPO_CONFIG.allowedPaths.filter((p) =>
      MOCK_REPO_CONFIG.protectedPaths.includes(p),
    );
    expect(overlap).toEqual([]);
  });
});
