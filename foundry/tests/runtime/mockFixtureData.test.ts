import { describe, it, expect } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";
import { MOCK_ISSUE, MOCK_LINEAR_STATES } from "../../src/mocks/mockLinearData.js";

describe("mockGitHubData fixtures", () => {
  it("MOCK_DIFF is a non-empty unified diff touching the expected files", () => {
    expect(typeof MOCK_DIFF).toBe("string");
    expect(MOCK_DIFF).toContain("diff --git a/src/middleware/validation.ts");
    expect(MOCK_DIFF).toContain("diff --git a/src/routes/users.ts");
    expect(MOCK_DIFF.length).toBeGreaterThan(0);
  });

  it("MOCK_REPO_CONFIG describes a repo with allowed and protected paths", () => {
    expect(MOCK_REPO_CONFIG).toEqual({
      name: "acme/backend-api",
      defaultBranch: "main",
      repoPath: "./workspace",
      allowedPaths: ["src/", "tests/", "package.json"],
      protectedPaths: [".github/", "infrastructure/", "prisma/migrations/"],
    });
  });
});

describe("mockLinearData fixtures", () => {
  it("MOCK_ISSUE has the shape of a LinearIssue with a well-formed description", () => {
    expect(MOCK_ISSUE.id).toBe("LIN-1042");
    expect(MOCK_ISSUE.identifier).toBe("LIN-1042");
    expect(MOCK_ISSUE.branchName).toBe("mock/lin-1042-add-request-validation-middleware");
    expect(MOCK_ISSUE.state).toBe("Todo");
    expect(MOCK_ISSUE.labels).toEqual(["bug", "api", "validation"]);
    expect(MOCK_ISSUE.priority).toBe(2);
    expect(MOCK_ISSUE.url).toBe("https://linear.app/mock-team/issue/LIN-1042");
    expect(MOCK_ISSUE.project).toBe("Backend Platform");
    expect(MOCK_ISSUE.cycle).toBe("Sprint 23");
    expect(MOCK_ISSUE.description).toContain("## Problem");
    expect(MOCK_ISSUE.description).toContain("## Acceptance Criteria");
  });

  it("MOCK_LINEAR_STATES enumerates the expected workflow states", () => {
    expect(MOCK_LINEAR_STATES).toEqual({
      todo: "Todo",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
      cancelled: "Cancelled",
    });
  });
});
