import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("mockGitHubData", () => {
  it("provides a MOCK_DIFF that looks like a valid unified git diff", () => {
    expect(MOCK_DIFF).toContain("diff --git a/");
    expect(MOCK_DIFF).toMatch(/^diff --git/);
    expect(MOCK_DIFF).toContain("@@");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
  });

  it("provides a MOCK_REPO_CONFIG with the fields RepoConfig-style consumers expect", () => {
    expect(MOCK_REPO_CONFIG.name).toBe("acme/backend-api");
    expect(MOCK_REPO_CONFIG.defaultBranch).toBe("main");
    expect(MOCK_REPO_CONFIG.repoPath).toBeTruthy();
    expect(Array.isArray(MOCK_REPO_CONFIG.allowedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.allowedPaths.length).toBeGreaterThan(0);
    expect(Array.isArray(MOCK_REPO_CONFIG.protectedPaths)).toBe(true);
    expect(MOCK_REPO_CONFIG.protectedPaths.length).toBeGreaterThan(0);
  });
});

describe("mockLinearData", () => {
  it("provides a MOCK_ISSUE with every field a LinearIssue consumer relies on", () => {
    expect(MOCK_ISSUE.id).toBeTruthy();
    expect(MOCK_ISSUE.identifier).toBeTruthy();
    expect(MOCK_ISSUE.title.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.branchName).toMatch(/^[a-z0-9/-]+$/);
    expect(MOCK_ISSUE.description.length).toBeGreaterThan(0);
    expect(Object.values(MOCK_LINEAR_STATES)).toContain(MOCK_ISSUE.state);
    expect(Array.isArray(MOCK_ISSUE.labels)).toBe(true);
    expect(MOCK_ISSUE.labels.length).toBeGreaterThan(0);
    expect(typeof MOCK_ISSUE.priority).toBe("number");
    expect(MOCK_ISSUE.url).toContain("https://");
  });

  it("exposes MOCK_LINEAR_STATES as a fixed, non-empty set of distinct state labels", () => {
    const values = Object.values(MOCK_LINEAR_STATES);
    expect(values.length).toBeGreaterThan(0);
    expect(new Set(values).size).toBe(values.length);
    expect(MOCK_LINEAR_STATES.todo).toBe("Todo");
    expect(MOCK_LINEAR_STATES.done).toBe("Done");
  });
});
