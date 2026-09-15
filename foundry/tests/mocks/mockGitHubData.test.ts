import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("MOCK_DIFF", () => {
  it("is a non-empty unified diff string", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
  });

  it("contains valid unified-diff headers for each changed file", () => {
    expect(MOCK_DIFF).toContain("diff --git a/src/middleware/validation.ts b/src/middleware/validation.ts");
    expect(MOCK_DIFF).toContain("diff --git a/src/routes/users.ts b/src/routes/users.ts");
    expect(MOCK_DIFF).toContain("new file mode 100644");
    expect(MOCK_DIFF).toContain("--- /dev/null");
    expect(MOCK_DIFF).toContain("+++ b/src/middleware/validation.ts");
  });

  it("contains hunk headers marking added/changed line ranges", () => {
    expect(MOCK_DIFF).toMatch(/@@ -0,0 \+1,45 @@/);
    expect(MOCK_DIFF).toMatch(/@@ -1,8 \+1,18 @@/);
  });

  it("shows added lines (prefixed with +) introducing the validation middleware", () => {
    expect(MOCK_DIFF).toContain("+export function validateBody(schema: ZodSchema) {");
    expect(MOCK_DIFF).toContain("+export function validateQuery(schema: ZodSchema) {");
  });
});

describe("MOCK_REPO_CONFIG", () => {
  it("has the expected repo identity fields", () => {
    expect(MOCK_REPO_CONFIG.name).toBe("acme/backend-api");
    expect(MOCK_REPO_CONFIG.defaultBranch).toBe("main");
    expect(MOCK_REPO_CONFIG.repoPath).toBe("./workspace");
  });

  it("declares allowedPaths as a non-empty array of strings", () => {
    expect(Array.isArray(MOCK_REPO_CONFIG.allowedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.allowedPaths).toEqual(["src/", "tests/", "package.json"]);
  });

  it("declares protectedPaths guarding sensitive directories", () => {
    expect(MOCK_REPO_CONFIG.protectedPaths).toEqual([
      ".github/",
      "infrastructure/",
      "prisma/migrations/",
    ]);
  });

  it("keeps allowedPaths and protectedPaths disjoint", () => {
    const overlap = MOCK_REPO_CONFIG.allowedPaths.filter((p) =>
      MOCK_REPO_CONFIG.protectedPaths.includes(p),
    );
    expect(overlap).toEqual([]);
  });
});
