import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("MOCK_DIFF", () => {
  it("is a non-empty string in unified diff format", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
    expect(MOCK_DIFF).toContain("diff --git");
    expect(MOCK_DIFF).toContain("--- /dev/null");
    expect(MOCK_DIFF).toContain("+++ b/src/middleware/validation.ts");
  });

  it("contains hunk headers for both files it touches", () => {
    expect(MOCK_DIFF).toContain("diff --git a/src/middleware/validation.ts b/src/middleware/validation.ts");
    expect(MOCK_DIFF).toContain("diff --git a/src/routes/users.ts b/src/routes/users.ts");
    expect(MOCK_DIFF).toContain("@@ -0,0 +1,45 @@");
  });
});

describe("MOCK_REPO_CONFIG", () => {
  it("has the exact expected shape and field values", () => {
    expect(MOCK_REPO_CONFIG).toEqual({
      name: "acme/backend-api",
      defaultBranch: "main",
      repoPath: "./workspace",
      allowedPaths: ["src/", "tests/", "package.json"],
      protectedPaths: [".github/", "infrastructure/", "prisma/migrations/"],
    });
  });

  it("has string name/defaultBranch/repoPath fields and array allowedPaths/protectedPaths fields", () => {
    expect(typeof MOCK_REPO_CONFIG.name).toBe("string");
    expect(typeof MOCK_REPO_CONFIG.defaultBranch).toBe("string");
    expect(typeof MOCK_REPO_CONFIG.repoPath).toBe("string");
    expect(Array.isArray(MOCK_REPO_CONFIG.allowedPaths)).toBe(true);
    expect(Array.isArray(MOCK_REPO_CONFIG.protectedPaths)).toBe(true);
  });
});
