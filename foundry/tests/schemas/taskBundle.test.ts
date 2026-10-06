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
  const valid = {
    id: "LIN-1",
    title: "Fix bug",
    description: "Something is broken",
    labels: ["bug"],
    priority: 2,
  };

  it("parses a valid issue, with optional project/cycle omitted", () => {
    const result = IssueSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("parses a valid issue including optional project and cycle", () => {
    const result = IssueSchema.safeParse({ ...valid, project: "Backend", cycle: "Sprint 1" });
    expect(result.success).toBe(true);
  });

  it("fails when a required field (title) is missing", () => {
    const { id, ...rest } = valid;
    void id;
    const result = IssueSchema.safeParse({ ...rest, id: "LIN-1", title: undefined });
    expect(result.success).toBe(false);
  });

  it("fails when labels is the wrong type", () => {
    const result = IssueSchema.safeParse({ ...valid, labels: "not-an-array" });
    expect(result.success).toBe(false);
  });

  it("fails when priority is out of the 0-4 range (negative)", () => {
    const result = IssueSchema.safeParse({ ...valid, priority: -1 });
    expect(result.success).toBe(false);
  });

  it("fails when priority is out of the 0-4 range (too high)", () => {
    const result = IssueSchema.safeParse({ ...valid, priority: 5 });
    expect(result.success).toBe(false);
  });

  it("accepts priority at the boundaries 0 and 4", () => {
    expect(IssueSchema.safeParse({ ...valid, priority: 0 }).success).toBe(true);
    expect(IssueSchema.safeParse({ ...valid, priority: 4 }).success).toBe(true);
  });

  it("fails when priority is not an integer", () => {
    const result = IssueSchema.safeParse({ ...valid, priority: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  const valid = {
    name: "acme/repo",
    defaultBranch: "main",
    workingBranch: "ai/run-1",
    repoPath: "./workspace/repo",
    allowedPaths: ["src/"],
    protectedPaths: [".github/"],
  };

  it("parses a valid repo config", () => {
    expect(RepoConfigSchema.safeParse(valid).success).toBe(true);
  });

  it("fails when a required field (repoPath) is missing", () => {
    const { repoPath, ...rest } = valid;
    void repoPath;
    expect(RepoConfigSchema.safeParse(rest).success).toBe(false);
  });

  it("fails when allowedPaths is not an array of strings", () => {
    const result = RepoConfigSchema.safeParse({ ...valid, allowedPaths: [123] });
    expect(result.success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  const valid = {
    requiredChecks: ["lint", "typecheck"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };

  it("parses valid constraints", () => {
    expect(ConstraintsSchema.safeParse(valid).success).toBe(true);
  });

  it("fails when maxFilesChanged is zero or negative", () => {
    expect(ConstraintsSchema.safeParse({ ...valid, maxFilesChanged: 0 }).success).toBe(false);
    expect(ConstraintsSchema.safeParse({ ...valid, maxFilesChanged: -5 }).success).toBe(false);
  });

  it("fails when maxDiffLines is not an integer", () => {
    expect(ConstraintsSchema.safeParse({ ...valid, maxDiffLines: 1.2 }).success).toBe(false);
  });

  it("fails when requiredChecks is missing", () => {
    const { requiredChecks, ...rest } = valid;
    void requiredChecks;
    expect(ConstraintsSchema.safeParse(rest).success).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  const valid = {
    id: "LIN-2",
    title: "Parent issue",
    description: "desc",
    state: "In Progress",
    labels: ["epic"],
    priority: 1,
  };

  it("parses a valid related issue without optional identifier/url", () => {
    expect(RelatedIssueSchema.safeParse(valid).success).toBe(true);
  });

  it("parses a valid related issue including optional identifier and url", () => {
    const result = RelatedIssueSchema.safeParse({
      ...valid,
      identifier: "ENG-2",
      url: "https://linear.app/team/issue/ENG-2",
    });
    expect(result.success).toBe(true);
  });

  it("fails when state is missing", () => {
    const { state, ...rest } = valid;
    void state;
    expect(RelatedIssueSchema.safeParse(rest).success).toBe(false);
  });

  it("fails when priority is out of range", () => {
    expect(RelatedIssueSchema.safeParse({ ...valid, priority: 10 }).success).toBe(false);
  });
});

describe("RelatedContextSchema", () => {
  const relatedIssue = {
    id: "LIN-2",
    title: "Blocker issue",
    description: "desc",
    state: "Todo",
    labels: [],
    priority: 1,
  };

  it("parses a valid related context with a parent and blockers", () => {
    const result = RelatedContextSchema.safeParse({
      parent: relatedIssue,
      blockers: [relatedIssue],
    });
    expect(result.success).toBe(true);
  });

  it("parses a valid related context with no parent and an empty blockers array", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("fails when blockers is missing", () => {
    const result = RelatedContextSchema.safeParse({ parent: relatedIssue });
    expect(result.success).toBe(false);
  });

  it("fails when a blocker entry is malformed", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [{ id: "only-id" }] });
    expect(result.success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  const issue = {
    id: "LIN-1",
    title: "Fix bug",
    description: "desc",
    labels: [],
    priority: 2,
  };
  const repo = {
    name: "acme/repo",
    defaultBranch: "main",
    workingBranch: "ai/run-1",
    repoPath: "./workspace/repo",
    allowedPaths: ["src/"],
    protectedPaths: [],
  };
  const constraints = {
    requiredChecks: [],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };
  const valid = {
    issue,
    repo,
    constraints,
    definitionOfDone: ["All tests pass"],
  };

  it("parses a valid task bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("parses a valid task bundle including relatedContext", () => {
    const result = TaskBundleSchema.safeParse({
      ...valid,
      relatedContext: { blockers: [] },
    });
    expect(result.success).toBe(true);
  });

  it("fails when the nested issue is invalid (bad priority)", () => {
    const result = TaskBundleSchema.safeParse({
      ...valid,
      issue: { ...issue, priority: 99 },
    });
    expect(result.success).toBe(false);
  });

  it("fails when definitionOfDone is missing", () => {
    const { definitionOfDone, ...rest } = valid;
    void definitionOfDone;
    expect(TaskBundleSchema.safeParse(rest).success).toBe(false);
  });

  it("fails when a top-level required section (repo) is missing", () => {
    const { repo: _repo, ...rest } = valid;
    void _repo;
    expect(TaskBundleSchema.safeParse(rest).success).toBe(false);
  });
});
