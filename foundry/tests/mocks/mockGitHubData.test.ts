import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("MOCK_DIFF", () => {
  it("is a non-empty unified diff string", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
  });

  it("contains standard unified diff markers", () => {
    expect(MOCK_DIFF).toContain("diff --git");
    expect(MOCK_DIFF).toContain("--- /dev/null");
    expect(MOCK_DIFF).toContain("+++ b/src/middleware/validation.ts");
    expect(MOCK_DIFF).toContain("@@");
  });

  it("references more than one changed file", () => {
    const fileHeaders = MOCK_DIFF.match(/^diff --git/gm) ?? [];
    expect(fileHeaders.length).toBeGreaterThanOrEqual(2);
  });
});

describe("MOCK_REPO_CONFIG", () => {
  it("matches the expected shape used to seed repo config fixtures", () => {
    expect(MOCK_REPO_CONFIG).toEqual({
      name: "acme/backend-api",
      defaultBranch: "main",
      repoPath: "./workspace",
      allowedPaths: expect.arrayContaining(["src/", "tests/", "package.json"]),
      protectedPaths: expect.arrayContaining([
        ".github/",
        "infrastructure/",
        "prisma/migrations/",
      ]),
    });
  });

  it("has non-empty allowedPaths and protectedPaths arrays", () => {
    expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
    expect(MOCK_REPO_CONFIG.protectedPaths.length).toBeGreaterThan(0);
  });
});
