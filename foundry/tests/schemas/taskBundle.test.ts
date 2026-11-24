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
  it("accepts a valid issue", () => {
    const result = IssueSchema.safeParse({
      id: "LIN-1",
      title: "Title",
      description: "Desc",
      labels: ["bug"],
      priority: 2,
    });
    expect(result.success).toBe(true);
  });

  it("rejects priority out of range", () => {
    const result = IssueSchema.safeParse({
      id: "LIN-1",
      title: "Title",
      description: "Desc",
      labels: [],
      priority: 5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer priority", () => {
    const result = IssueSchema.safeParse({
      id: "LIN-1",
      title: "Title",
      description: "Desc",
      labels: [],
      priority: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("rejects a zero or negative maxFilesChanged", () => {
    expect(
      ConstraintsSchema.safeParse({
        requiredChecks: [],
        maxFilesChanged: 0,
        maxDiffLines: 10,
        forbiddenPatterns: [],
        mustNotTouch: [],
      }).success,
    ).toBe(false);
  });

  it("accepts positive limits", () => {
    expect(
      ConstraintsSchema.safeParse({
        requiredChecks: ["lint"],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      }).success,
    ).toBe(true);
  });
});

describe("RepoConfigSchema", () => {
  it("requires all path fields", () => {
    const result = RepoConfigSchema.safeParse({
      name: "repo",
      defaultBranch: "main",
      workingBranch: "main",
      repoPath: "/tmp",
      allowedPaths: [],
      protectedPaths: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("RelatedIssueSchema / RelatedContextSchema", () => {
  it("allows optional identifier and url to be omitted", () => {
    const result = RelatedIssueSchema.safeParse({
      id: "p1",
      title: "Parent",
      description: "desc",
      state: "In Progress",
      labels: [],
      priority: 1,
    });
    expect(result.success).toBe(true);
  });

  it("validates an empty blockers array with no parent", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });
});

describe("TaskBundleSchema", () => {
  it("validates a full, well-formed bundle", () => {
    const result = TaskBundleSchema.safeParse({
      issue: {
        id: "LIN-1",
        title: "Title",
        description: "Desc",
        labels: [],
        priority: 1,
      },
      repo: {
        name: "repo",
        defaultBranch: "main",
        workingBranch: "ai/lin-1",
        repoPath: "/tmp",
        allowedPaths: ["src/"],
        protectedPaths: [],
      },
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
      definitionOfDone: ["Tests pass"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a bundle missing required fields", () => {
    const result = TaskBundleSchema.safeParse({ issue: {} });
    expect(result.success).toBe(false);
  });
});
