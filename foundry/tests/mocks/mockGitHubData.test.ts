import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";
import { RepoConfigSchema } from "../../src/schemas/taskBundle.js";

describe("MOCK_DIFF", () => {
  it("is a non-empty unified diff string with expected diff markers", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
    expect(MOCK_DIFF).toContain("diff --git");
    expect(MOCK_DIFF).toContain("+++ b/");
    expect(MOCK_DIFF).toContain("--- a/");
  });

  it("references the validation middleware file consistent with the mock scenario", () => {
    expect(MOCK_DIFF).toContain("src/middleware/validation.ts");
  });
});

describe("MOCK_REPO_CONFIG", () => {
  it("has the expected shape", () => {
    expect(MOCK_REPO_CONFIG).toMatchObject({
      name: "acme/backend-api",
      defaultBranch: "main",
      repoPath: "./workspace",
    });
    expect(Array.isArray(MOCK_REPO_CONFIG.allowedPaths)).toBe(true);
    expect(Array.isArray(MOCK_REPO_CONFIG.protectedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
    expect(MOCK_REPO_CONFIG.protectedPaths.length).toBeGreaterThan(0);
  });

  it("is schema-valid as a RepoConfig once a workingBranch is supplied", () => {
    // MOCK_REPO_CONFIG omits `workingBranch`, which callers fill in per-run;
    // verify the rest of the shape satisfies RepoConfigSchema when combined with one.
    const candidate = { ...MOCK_REPO_CONFIG, workingBranch: "feature/mock-branch" };
    const result = RepoConfigSchema.safeParse(candidate);
    expect(result.success).toBe(true);
  });
});
