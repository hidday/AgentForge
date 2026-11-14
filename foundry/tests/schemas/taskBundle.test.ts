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
  id: "issue-1",
  title: "Fix the bug",
  description: "Something is broken",
  labels: ["bug"],
  priority: 2,
};

const validRepo = {
  name: "agentforge",
  defaultBranch: "master",
  workingBranch: "feature/x",
  repoPath: "/repo",
  allowedPaths: ["src/"],
  protectedPaths: ["src/generated/"],
};

const validConstraints = {
  requiredChecks: ["lint"],
  maxFilesChanged: 10,
  maxDiffLines: 500,
  forbiddenPatterns: ["TODO"],
  mustNotTouch: ["package.json"],
};

describe("taskBundle schemas", () => {
  it("accepts a valid issue and rejects priority out of range", () => {
    expect(IssueSchema.safeParse(validIssue).success).toBe(true);
    expect(IssueSchema.safeParse({ ...validIssue, priority: 5 }).success).toBe(false);
    expect(IssueSchema.safeParse({ ...validIssue, priority: -1 }).success).toBe(false);
  });

  it("allows project and cycle to be omitted on an issue", () => {
    const result = IssueSchema.safeParse(validIssue);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project).toBeUndefined();
      expect(result.data.cycle).toBeUndefined();
    }
  });

  it("accepts a valid repo config and rejects a missing required field", () => {
    expect(RepoConfigSchema.safeParse(validRepo).success).toBe(true);
    const { name, ...withoutName } = validRepo;
    expect(RepoConfigSchema.safeParse(withoutName).success).toBe(false);
  });

  it("accepts valid constraints and rejects non-positive numeric limits", () => {
    expect(ConstraintsSchema.safeParse(validConstraints).success).toBe(true);
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints, maxFilesChanged: 0 }).success,
    ).toBe(false);
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints, maxDiffLines: -1 }).success,
    ).toBe(false);
  });

  it("validates a related issue, with identifier and url optional", () => {
    const relatedIssue = {
      id: "r-1",
      title: "Blocker",
      description: "blocks this",
      state: "In Progress",
      labels: [],
      priority: 1,
    };
    expect(RelatedIssueSchema.safeParse(relatedIssue).success).toBe(true);
    expect(RelatedIssueSchema.safeParse({ ...relatedIssue, priority: 10 }).success).toBe(false);
  });

  it("validates related context with an optional parent and a blockers array", () => {
    const relatedIssue = {
      id: "r-1",
      title: "Blocker",
      description: "blocks this",
      state: "In Progress",
      labels: [],
      priority: 1,
    };
    expect(RelatedContextSchema.safeParse({ blockers: [relatedIssue] }).success).toBe(true);
    expect(RelatedContextSchema.safeParse({ blockers: [] }).success).toBe(true);
    expect(RelatedContextSchema.safeParse({ parent: relatedIssue, blockers: [] }).success).toBe(
      true,
    );
  });

  it("validates a full task bundle and rejects one missing a required section", () => {
    const bundle = {
      issue: validIssue,
      repo: validRepo,
      constraints: validConstraints,
      definitionOfDone: ["Tests pass"],
    };
    expect(TaskBundleSchema.safeParse(bundle).success).toBe(true);
    const { repo, ...withoutRepo } = bundle;
    expect(TaskBundleSchema.safeParse(withoutRepo).success).toBe(false);
  });
});
