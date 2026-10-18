import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";

describe("MOCK_DIFF", () => {
  it("is a non-empty unified-diff-formatted string", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
    expect(MOCK_DIFF).toContain("diff --git");
  });

  it("contains at least one file header pair (--- / +++) for each diff section", () => {
    const minusHeaders = MOCK_DIFF.match(/^--- /gm) ?? [];
    const plusHeaders = MOCK_DIFF.match(/^\+\+\+ /gm) ?? [];
    expect(minusHeaders.length).toBeGreaterThan(0);
    expect(minusHeaders.length).toBe(plusHeaders.length);
  });

  it("contains at least one hunk header", () => {
    expect(MOCK_DIFF).toMatch(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m);
  });
});

describe("MOCK_REPO_CONFIG", () => {
  it("has a well-formed owner/repo name", () => {
    expect(MOCK_REPO_CONFIG.name).toMatch(/^[\w.-]+\/[\w.-]+$/);
  });

  it("has a non-empty default branch and repo path", () => {
    expect(MOCK_REPO_CONFIG.defaultBranch.length).toBeGreaterThan(0);
    expect(MOCK_REPO_CONFIG.repoPath.length).toBeGreaterThan(0);
  });

  it("has non-empty allowedPaths and protectedPaths arrays of strings", () => {
    expect(Array.isArray(MOCK_REPO_CONFIG.allowedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
    expect(MOCK_REPO_CONFIG.allowedPaths.every((p) => typeof p === "string" && p.length > 0)).toBe(
      true,
    );

    expect(Array.isArray(MOCK_REPO_CONFIG.protectedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.protectedPaths.length).toBeGreaterThan(0);
    expect(
      MOCK_REPO_CONFIG.protectedPaths.every((p) => typeof p === "string" && p.length > 0),
    ).toBe(true);
  });

  it("does not list the same path in both allowedPaths and protectedPaths", () => {
    const overlap = MOCK_REPO_CONFIG.allowedPaths.filter((p) =>
      MOCK_REPO_CONFIG.protectedPaths.includes(p as never),
    );
    expect(overlap).toEqual([]);
  });
});
