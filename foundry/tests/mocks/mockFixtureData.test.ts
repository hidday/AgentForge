import { describe, it, expect } from "vitest";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";
import { IssueSchema, RepoConfigSchema } from "../../src/schemas/taskBundle.js";

describe("mockLinearData fixtures", () => {
  it("MOCK_ISSUE satisfies the shape required by IssueSchema", () => {
    expect(() =>
      IssueSchema.parse({
        id: MOCK_ISSUE.id,
        title: MOCK_ISSUE.title,
        description: MOCK_ISSUE.description,
        labels: MOCK_ISSUE.labels,
        priority: MOCK_ISSUE.priority,
        project: MOCK_ISSUE.project,
        cycle: MOCK_ISSUE.cycle,
      }),
    ).not.toThrow();
  });

  it("MOCK_ISSUE has a branchName and a non-empty description", () => {
    expect(MOCK_ISSUE.branchName.length).toBeGreaterThan(0);
    expect(MOCK_ISSUE.description.length).toBeGreaterThan(0);
  });

  it("MOCK_LINEAR_STATES enumerates the five workflow states used by LinearSyncService's mapping", () => {
    expect(Object.values(MOCK_LINEAR_STATES)).toEqual([
      "Todo",
      "In Progress",
      "In Review",
      "Done",
      "Cancelled",
    ]);
  });
});

describe("mockGitHubData fixtures", () => {
  it("MOCK_DIFF looks like a unified git diff", () => {
    expect(MOCK_DIFF).toContain("diff --git");
    expect(MOCK_DIFF).toContain("@@");
  });

  it("MOCK_REPO_CONFIG satisfies RepoConfigSchema when given a workingBranch", () => {
    expect(() =>
      RepoConfigSchema.parse({ ...MOCK_REPO_CONFIG, workingBranch: "ai/mock" }),
    ).not.toThrow();
  });

  it("MOCK_REPO_CONFIG protects infrastructure-sensitive paths", () => {
    expect(MOCK_REPO_CONFIG.protectedPaths).toContain(".github/");
    expect(MOCK_REPO_CONFIG.protectedPaths).toContain("prisma/migrations/");
  });
});
