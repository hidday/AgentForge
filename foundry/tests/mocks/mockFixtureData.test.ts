import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("mockGitHubData", () => {
  it("MOCK_DIFF is a well-formed unified diff with at least one file header per hunk", () => {
    const fileHeaders = MOCK_DIFF.match(/^diff --git a\/.+ b\/.+$/gm) ?? [];
    expect(fileHeaders.length).toBeGreaterThanOrEqual(2);

    // Every hunk marker must be preceded, somewhere above it, by a file header.
    const hunkMarkers = MOCK_DIFF.match(/^@@ .+ @@/gm) ?? [];
    expect(hunkMarkers.length).toBeGreaterThan(0);
  });

  it("MOCK_REPO_CONFIG declares disjoint allowed and protected path prefixes", () => {
    for (const allowed of MOCK_REPO_CONFIG.allowedPaths) {
      for (const protectedPath of MOCK_REPO_CONFIG.protectedPaths) {
        expect(allowed.startsWith(protectedPath)).toBe(false);
        expect(protectedPath.startsWith(allowed)).toBe(false);
      }
    }
    expect(MOCK_REPO_CONFIG.name).toMatch(/^[\w-]+\/[\w-]+$/);
  });
});

describe("mockLinearData", () => {
  it("MOCK_ISSUE.id and identifier agree, and required fields are non-empty", () => {
    expect(MOCK_ISSUE.id).toBe(MOCK_ISSUE.identifier);
    expect(MOCK_ISSUE.title.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.branchName.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.description.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.url).toContain(MOCK_ISSUE.identifier);
  });

  it("MOCK_ISSUE.state is one of the declared MOCK_LINEAR_STATES values", () => {
    expect(Object.values(MOCK_LINEAR_STATES)).toContain(MOCK_ISSUE.state);
  });

  it("MOCK_LINEAR_STATES has no duplicate state labels", () => {
    const values = Object.values(MOCK_LINEAR_STATES);
    expect(new Set(values).size).toBe(values.length);
  });
});
