import { describe, it, expect } from "vitest";
import {
  TaskBundleSchema,
  IssueSchema,
  ConstraintsSchema,
  RepoConfigSchema,
} from "../../src/schemas/taskBundle.js";

const validIssue = {
  id: "ISS-1",
  title: "Title",
  description: "Desc",
  labels: ["bug"],
  priority: 2,
};

const validRepo = {
  name: "repo",
  defaultBranch: "main",
  workingBranch: "feature/x",
  repoPath: "/repo",
  allowedPaths: ["src/"],
  protectedPaths: [],
};

const validConstraints = {
  requiredChecks: ["ci"],
  maxFilesChanged: 10,
  maxDiffLines: 500,
  forbiddenPatterns: [],
  mustNotTouch: [],
};

describe("TaskBundleSchema", () => {
  it("accepts a fully valid bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse({
      issue: validIssue,
      repo: validRepo,
      constraints: validConstraints,
      definitionOfDone: ["done"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a bundle with relatedContext including blockers and an optional parent", () => {
    const result = TaskBundleSchema.safeParse({
      issue: validIssue,
      repo: validRepo,
      constraints: validConstraints,
      definitionOfDone: ["done"],
      relatedContext: {
        parent: { id: "P-1", title: "Parent", description: "d", state: "Done", labels: [], priority: 1 },
        blockers: [
          { id: "B-1", title: "Blocker", description: "d", state: "Todo", labels: [], priority: 0 },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts relatedContext with no parent and empty blockers", () => {
    const result = TaskBundleSchema.safeParse({
      issue: validIssue,
      repo: validRepo,
      constraints: validConstraints,
      definitionOfDone: [],
      relatedContext: { blockers: [] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a bundle missing a required top-level field", () => {
    const result = TaskBundleSchema.safeParse({
      repo: validRepo,
      constraints: validConstraints,
      definitionOfDone: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("IssueSchema", () => {
  it.each([-1, 5])("rejects out-of-range priority %d", (priority) => {
    const result = IssueSchema.safeParse({ ...validIssue, priority });
    expect(result.success).toBe(false);
  });

  it.each([0, 4])("accepts boundary priority %d", (priority) => {
    const result = IssueSchema.safeParse({ ...validIssue, priority });
    expect(result.success).toBe(true);
  });

  it("allows project and cycle to be omitted", () => {
    const result = IssueSchema.safeParse(validIssue);
    expect(result.success).toBe(true);
  });
});

describe("RepoConfigSchema", () => {
  it("rejects a repo config missing allowedPaths", () => {
    const { allowedPaths, ...rest } = validRepo;
    expect(allowedPaths).toBeDefined();
    const result = RepoConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("rejects a non-positive maxFilesChanged", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints, maxFilesChanged: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer maxDiffLines", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints, maxDiffLines: 1.5 });
    expect(result.success).toBe(false);
  });

  it("accepts valid constraints", () => {
    const result = ConstraintsSchema.safeParse(validConstraints);
    expect(result.success).toBe(true);
  });
});
