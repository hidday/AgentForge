import { describe, it, expect } from "vitest";
import {
  IssueSchema,
  RepoConfigSchema,
  ConstraintsSchema,
  RelatedIssueSchema,
  RelatedContextSchema,
  TaskBundleSchema,
} from "../../src/schemas/taskBundle.js";

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "LIN-1",
    title: "Fix bug",
    description: "Something is broken",
    labels: ["bug"],
    priority: 2,
    ...overrides,
  };
}

function makeRepoConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: "test-repo",
    defaultBranch: "main",
    workingBranch: "ai/lin-1",
    repoPath: "/tmp/repo",
    allowedPaths: ["src/"],
    protectedPaths: [],
    ...overrides,
  };
}

function makeConstraints(overrides: Record<string, unknown> = {}) {
  return {
    requiredChecks: ["lint", "test"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
    ...overrides,
  };
}

describe("IssueSchema", () => {
  it("accepts a valid issue including optional fields", () => {
    const result = IssueSchema.safeParse(makeIssue({ project: "Core", cycle: "Sprint 1" }));
    expect(result.success).toBe(true);
  });

  it("rejects priority out of range", () => {
    expect(IssueSchema.safeParse(makeIssue({ priority: 5 })).success).toBe(false);
    expect(IssueSchema.safeParse(makeIssue({ priority: -1 })).success).toBe(false);
  });

  it("accepts the boundary priorities 0 and 4", () => {
    expect(IssueSchema.safeParse(makeIssue({ priority: 0 })).success).toBe(true);
    expect(IssueSchema.safeParse(makeIssue({ priority: 4 })).success).toBe(true);
  });

  it("rejects a non-integer priority", () => {
    expect(IssueSchema.safeParse(makeIssue({ priority: 1.5 })).success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { id, ...rest } = makeIssue();
    expect(IssueSchema.safeParse(rest).success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a valid repo config", () => {
    expect(RepoConfigSchema.safeParse(makeRepoConfig()).success).toBe(true);
  });

  it("rejects a non-array allowedPaths", () => {
    expect(RepoConfigSchema.safeParse(makeRepoConfig({ allowedPaths: "src/" })).success).toBe(
      false,
    );
  });
});

describe("ConstraintsSchema", () => {
  it("accepts valid constraints", () => {
    expect(ConstraintsSchema.safeParse(makeConstraints()).success).toBe(true);
  });

  it("rejects zero or negative maxFilesChanged", () => {
    expect(ConstraintsSchema.safeParse(makeConstraints({ maxFilesChanged: 0 })).success).toBe(
      false,
    );
    expect(ConstraintsSchema.safeParse(makeConstraints({ maxFilesChanged: -1 })).success).toBe(
      false,
    );
  });

  it("rejects a non-integer maxDiffLines", () => {
    expect(ConstraintsSchema.safeParse(makeConstraints({ maxDiffLines: 1.2 })).success).toBe(
      false,
    );
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a valid related issue without optional fields", () => {
    const result = RelatedIssueSchema.safeParse({
      id: "LIN-2",
      title: "Parent issue",
      description: "desc",
      state: "In Progress",
      labels: [],
      priority: 1,
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional identifier and url", () => {
    const result = RelatedIssueSchema.safeParse({
      id: "LIN-2",
      identifier: "ENG-2",
      title: "Parent issue",
      description: "desc",
      state: "In Progress",
      labels: [],
      priority: 1,
      url: "https://linear.app/issue/ENG-2",
    });
    expect(result.success).toBe(true);
  });
});

describe("RelatedContextSchema", () => {
  it("accepts an empty blockers array with no parent", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("accepts a parent and populated blockers", () => {
    const relatedIssue = {
      id: "LIN-2",
      title: "Blocker",
      description: "desc",
      state: "Todo",
      labels: [],
      priority: 0,
    };
    const result = RelatedContextSchema.safeParse({
      parent: relatedIssue,
      blockers: [relatedIssue],
    });
    expect(result.success).toBe(true);
  });

  it("rejects when blockers is missing", () => {
    expect(RelatedContextSchema.safeParse({}).success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  it("accepts a full valid bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse({
      issue: makeIssue(),
      repo: makeRepoConfig(),
      constraints: makeConstraints(),
      definitionOfDone: ["Tests pass"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a full valid bundle with relatedContext", () => {
    const result = TaskBundleSchema.safeParse({
      issue: makeIssue(),
      repo: makeRepoConfig(),
      constraints: makeConstraints(),
      definitionOfDone: [],
      relatedContext: { blockers: [] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a bundle with an invalid nested issue", () => {
    const result = TaskBundleSchema.safeParse({
      issue: makeIssue({ priority: 99 }),
      repo: makeRepoConfig(),
      constraints: makeConstraints(),
      definitionOfDone: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a bundle missing definitionOfDone", () => {
    const result = TaskBundleSchema.safeParse({
      issue: makeIssue(),
      repo: makeRepoConfig(),
      constraints: makeConstraints(),
    });
    expect(result.success).toBe(false);
  });
});
