import { describe, it, expect } from "vitest";
import {
  IssueSchema,
  RepoConfigSchema,
  ConstraintsSchema,
  RelatedIssueSchema,
  RelatedContextSchema,
  TaskBundleSchema,
} from "../../src/schemas/taskBundle.js";

describe("IssueSchema", () => {
  it("parses a valid issue", () => {
    const issue = {
      id: "ENG-1",
      title: "Fix bug",
      description: "Details",
      labels: ["bug"],
      priority: 2,
      project: "Backend",
      cycle: "Sprint 1",
    };
    expect(IssueSchema.parse(issue)).toEqual(issue);
  });

  it("parses without the optional fields", () => {
    const issue = {
      id: "ENG-1",
      title: "Fix bug",
      description: "Details",
      labels: [],
      priority: 0,
    };
    expect(IssueSchema.parse(issue)).toEqual(issue);
  });

  it("fails when priority is out of range", () => {
    const result = IssueSchema.safeParse({
      id: "ENG-1",
      title: "Fix bug",
      description: "Details",
      labels: [],
      priority: 5,
    });
    expect(result.success).toBe(false);
  });

  it("fails when a required field is missing", () => {
    const result = IssueSchema.safeParse({
      title: "Fix bug",
      description: "Details",
      labels: [],
      priority: 1,
    });
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("parses a valid repo config", () => {
    const repo = {
      name: "acme/backend",
      defaultBranch: "main",
      workingBranch: "feature/x",
      repoPath: "./workspace",
      allowedPaths: ["src/"],
      protectedPaths: [".github/"],
    };
    expect(RepoConfigSchema.parse(repo)).toEqual(repo);
  });

  it("fails when allowedPaths is not an array", () => {
    const result = RepoConfigSchema.safeParse({
      name: "acme/backend",
      defaultBranch: "main",
      workingBranch: "feature/x",
      repoPath: "./workspace",
      allowedPaths: "src/",
      protectedPaths: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("parses a valid constraints object", () => {
    const constraints = {
      requiredChecks: ["lint", "test"],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: ["eval\\("],
      mustNotTouch: ["infra/"],
    };
    expect(ConstraintsSchema.parse(constraints)).toEqual(constraints);
  });

  it("fails when maxFilesChanged is not positive", () => {
    const result = ConstraintsSchema.safeParse({
      requiredChecks: [],
      maxFilesChanged: 0,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    });
    expect(result.success).toBe(false);
  });

  it("fails when maxDiffLines is not an integer", () => {
    const result = ConstraintsSchema.safeParse({
      requiredChecks: [],
      maxFilesChanged: 5,
      maxDiffLines: 1.5,
      forbiddenPatterns: [],
      mustNotTouch: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("parses a valid related issue", () => {
    const issue = {
      id: "ENG-2",
      identifier: "ENG-2",
      title: "Blocker",
      description: "desc",
      state: "Todo",
      labels: [],
      priority: 1,
      url: "https://linear.app/x",
    };
    expect(RelatedIssueSchema.parse(issue)).toEqual(issue);
  });

  it("parses without optional identifier/url", () => {
    const issue = {
      id: "ENG-2",
      title: "Blocker",
      description: "desc",
      state: "Todo",
      labels: [],
      priority: 1,
    };
    expect(RelatedIssueSchema.parse(issue)).toEqual(issue);
  });

  it("fails when priority exceeds the max of 4", () => {
    const result = RelatedIssueSchema.safeParse({
      id: "ENG-2",
      title: "Blocker",
      description: "desc",
      state: "Todo",
      labels: [],
      priority: 10,
    });
    expect(result.success).toBe(false);
  });
});

describe("RelatedContextSchema", () => {
  const relatedIssue = {
    id: "ENG-3",
    title: "Parent",
    description: "desc",
    state: "Todo",
    labels: [],
    priority: 0,
  };

  it("parses with a parent and blockers", () => {
    const context = { parent: relatedIssue, blockers: [relatedIssue] };
    expect(RelatedContextSchema.parse(context)).toEqual(context);
  });

  it("parses with no parent (optional) and empty blockers", () => {
    const context = { blockers: [] };
    expect(RelatedContextSchema.parse(context)).toEqual(context);
  });

  it("fails when blockers is missing", () => {
    const result = RelatedContextSchema.safeParse({ parent: relatedIssue });
    expect(result.success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  const validBundle = {
    issue: {
      id: "ENG-1",
      title: "Fix bug",
      description: "Details",
      labels: ["bug"],
      priority: 2,
    },
    repo: {
      name: "acme/backend",
      defaultBranch: "main",
      workingBranch: "feature/x",
      repoPath: "./workspace",
      allowedPaths: ["src/"],
      protectedPaths: [".github/"],
    },
    constraints: {
      requiredChecks: ["lint"],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: ["All tests pass"],
  };

  it("parses a full valid task bundle without relatedContext", () => {
    expect(TaskBundleSchema.parse(validBundle)).toEqual(validBundle);
  });

  it("parses a valid task bundle including relatedContext", () => {
    const withContext = {
      ...validBundle,
      relatedContext: { blockers: [] },
    };
    expect(TaskBundleSchema.parse(withContext)).toEqual(withContext);
  });

  it("fails when the nested issue is invalid", () => {
    const invalid = {
      ...validBundle,
      issue: { ...validBundle.issue, priority: 99 },
    };
    const result = TaskBundleSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("fails when definitionOfDone is missing", () => {
    const { definitionOfDone: _omit, ...rest } = validBundle;
    const result = TaskBundleSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});
