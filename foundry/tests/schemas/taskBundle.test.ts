import { describe, it, expect } from "vitest";
import {
  IssueSchema,
  RepoConfigSchema,
  ConstraintsSchema,
  RelatedIssueSchema,
  RelatedContextSchema,
  TaskBundleSchema,
} from "../../src/schemas/taskBundle.js";

function validIssue() {
  return {
    id: "LIN-1",
    title: "Fix bug",
    description: "Something is broken",
    labels: ["bug"],
    priority: 2,
  };
}

function validRepoConfig() {
  return {
    name: "test-repo",
    defaultBranch: "main",
    workingBranch: "ai/lin-1",
    repoPath: "/tmp/repo",
    allowedPaths: ["src/"],
    protectedPaths: ["infra/"],
  };
}

function validConstraints() {
  return {
    requiredChecks: ["lint", "test"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: ["*.env"],
    mustNotTouch: ["secrets/"],
  };
}

function validRelatedIssue() {
  return {
    id: "LIN-2",
    title: "Parent issue",
    description: "Parent description",
    state: "Todo",
    labels: [],
    priority: 1,
  };
}

describe("IssueSchema", () => {
  it("accepts a valid issue without optional fields", () => {
    const result = IssueSchema.safeParse(validIssue());
    expect(result.success).toBe(true);
  });

  it("accepts optional project and cycle fields", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), project: "Q1", cycle: "sprint-4" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project).toBe("Q1");
      expect(result.data.cycle).toBe("sprint-4");
    }
  });

  it("rejects priority above the max of 4", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["priority"]);
    }
  });

  it("rejects priority below the min of 0", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer priority", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects when a required field is missing", () => {
    const { title, ...rest } = validIssue();
    const result = IssueSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["title"]);
    }
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a valid repo config", () => {
    expect(RepoConfigSchema.safeParse(validRepoConfig()).success).toBe(true);
  });

  it("rejects when allowedPaths is not an array of strings", () => {
    const result = RepoConfigSchema.safeParse({ ...validRepoConfig(), allowedPaths: "src/" });
    expect(result.success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("accepts valid constraints", () => {
    expect(ConstraintsSchema.safeParse(validConstraints()).success).toBe(true);
  });

  it("rejects maxFilesChanged of zero (must be positive)", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative maxDiffLines", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxDiffLines: -5 });
    expect(result.success).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a valid related issue without optional fields", () => {
    expect(RelatedIssueSchema.safeParse(validRelatedIssue()).success).toBe(true);
  });

  it("accepts optional identifier and url", () => {
    const result = RelatedIssueSchema.safeParse({
      ...validRelatedIssue(),
      identifier: "ENG-2",
      url: "https://linear.app/x",
    });
    expect(result.success).toBe(true);
  });

  it("rejects priority out of range", () => {
    const result = RelatedIssueSchema.safeParse({ ...validRelatedIssue(), priority: 10 });
    expect(result.success).toBe(false);
  });
});

describe("RelatedContextSchema", () => {
  it("accepts an empty blockers array and no parent", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("accepts a parent and multiple blockers", () => {
    const result = RelatedContextSchema.safeParse({
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue(), { ...validRelatedIssue(), id: "LIN-3" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.blockers).toHaveLength(2);
    }
  });

  it("rejects when blockers is missing", () => {
    const result = RelatedContextSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  it("accepts a full, valid task bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse({
      issue: validIssue(),
      repo: validRepoConfig(),
      constraints: validConstraints(),
      definitionOfDone: ["All tests pass"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a task bundle with relatedContext present", () => {
    const result = TaskBundleSchema.safeParse({
      issue: validIssue(),
      repo: validRepoConfig(),
      constraints: validConstraints(),
      definitionOfDone: [],
      relatedContext: { blockers: [validRelatedIssue()] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects when a nested required object is missing", () => {
    const result = TaskBundleSchema.safeParse({
      issue: validIssue(),
      constraints: validConstraints(),
      definitionOfDone: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "repo")).toBe(true);
    }
  });

  it("rejects when a nested field fails its own validation (invalid issue priority)", () => {
    const result = TaskBundleSchema.safeParse({
      issue: { ...validIssue(), priority: 99 },
      repo: validRepoConfig(),
      constraints: validConstraints(),
      definitionOfDone: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "issue.priority")).toBe(true);
    }
  });
});
