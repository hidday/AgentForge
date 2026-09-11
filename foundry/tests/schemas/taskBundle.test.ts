import { describe, it, expect } from "vitest";
import {
  IssueSchema,
  RepoConfigSchema,
  ConstraintsSchema,
  RelatedIssueSchema,
  RelatedContextSchema,
  TaskBundleSchema,
} from "../../src/schemas/taskBundle.js";

const validIssue = {
  id: "LIN-1",
  title: "Fix the bug",
  description: "Some description",
  labels: ["bug"],
  priority: 2,
};

const validRepo = {
  name: "test-repo",
  defaultBranch: "main",
  workingBranch: "ai/lin-1",
  repoPath: "/tmp/repo",
  allowedPaths: ["src/"],
  protectedPaths: [],
};

const validConstraints = {
  requiredChecks: ["lint"],
  maxFilesChanged: 10,
  maxDiffLines: 500,
  forbiddenPatterns: [],
  mustNotTouch: [],
};

const validRelatedIssue = {
  id: "p1",
  title: "Parent issue",
  description: "desc",
  state: "In Progress",
  labels: [],
  priority: 1,
};

describe("IssueSchema", () => {
  it("accepts a valid issue including optional project/cycle", () => {
    const result = IssueSchema.safeParse({
      ...validIssue,
      project: "Project X",
      cycle: "Cycle 4",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid issue without the optional fields", () => {
    const result = IssueSchema.safeParse(validIssue);
    expect(result.success).toBe(true);
  });

  it("rejects when a required field is missing", () => {
    const { title: _title, ...withoutTitle } = validIssue;
    const result = IssueSchema.safeParse(withoutTitle);
    expect(result.success).toBe(false);
  });

  it("rejects when priority is out of range", () => {
    const result = IssueSchema.safeParse({ ...validIssue, priority: 5 });
    expect(result.success).toBe(false);
  });

  it("rejects when priority is negative", () => {
    const result = IssueSchema.safeParse({ ...validIssue, priority: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects when a field has the wrong type", () => {
    const result = IssueSchema.safeParse({ ...validIssue, labels: "not-an-array" });
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a valid repo config", () => {
    expect(RepoConfigSchema.safeParse(validRepo).success).toBe(true);
  });

  it("rejects when allowedPaths is missing", () => {
    const { allowedPaths: _allowedPaths, ...rest } = validRepo;
    expect(RepoConfigSchema.safeParse(rest).success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("accepts valid constraints", () => {
    expect(ConstraintsSchema.safeParse(validConstraints).success).toBe(true);
  });

  it("rejects a non-positive maxFilesChanged", () => {
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints, maxFilesChanged: 0 }).success,
    ).toBe(false);
  });

  it("rejects a non-integer maxDiffLines", () => {
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints, maxDiffLines: 1.5 }).success,
    ).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a valid related issue with optional identifier/url", () => {
    const result = RelatedIssueSchema.safeParse({
      ...validRelatedIssue,
      identifier: "PRY-100",
      url: "https://linear.app/team/issue/PRY-100",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid related issue without optional fields", () => {
    expect(RelatedIssueSchema.safeParse(validRelatedIssue).success).toBe(true);
  });

  it("rejects when state is missing", () => {
    const { state: _state, ...rest } = validRelatedIssue;
    expect(RelatedIssueSchema.safeParse(rest).success).toBe(false);
  });
});

describe("RelatedContextSchema", () => {
  it("accepts blockers-only related context (no parent)", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [validRelatedIssue] });
    expect(result.success).toBe(true);
  });

  it("accepts a parent plus blockers", () => {
    const result = RelatedContextSchema.safeParse({
      parent: validRelatedIssue,
      blockers: [validRelatedIssue],
    });
    expect(result.success).toBe(true);
  });

  it("rejects when blockers is missing", () => {
    const result = RelatedContextSchema.safeParse({ parent: validRelatedIssue });
    expect(result.success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  it("accepts a fully valid task bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse({
      issue: validIssue,
      repo: validRepo,
      constraints: validConstraints,
      definitionOfDone: ["Tests pass"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a fully valid task bundle with relatedContext", () => {
    const result = TaskBundleSchema.safeParse({
      issue: validIssue,
      repo: validRepo,
      constraints: validConstraints,
      definitionOfDone: [],
      relatedContext: { blockers: [] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects when a nested required object (repo) is missing", () => {
    const result = TaskBundleSchema.safeParse({
      issue: validIssue,
      constraints: validConstraints,
      definitionOfDone: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects when definitionOfDone has the wrong type", () => {
    const result = TaskBundleSchema.safeParse({
      issue: validIssue,
      repo: validRepo,
      constraints: validConstraints,
      definitionOfDone: "not an array",
    });
    expect(result.success).toBe(false);
  });
});
