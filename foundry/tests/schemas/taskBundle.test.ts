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
    title: "Test issue",
    description: "A description",
    labels: ["bug"],
    priority: 2,
  };
}

function validRepoConfig() {
  return {
    name: "test-repo",
    defaultBranch: "main",
    workingBranch: "ai/lin-1",
    repoPath: "/tmp",
    allowedPaths: ["src/"],
    protectedPaths: [],
  };
}

function validConstraints() {
  return {
    requiredChecks: ["lint"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };
}

function validRelatedIssue() {
  return {
    id: "b1",
    title: "Blocker",
    description: "desc",
    state: "Todo",
    labels: [],
    priority: 1,
  };
}

describe("IssueSchema", () => {
  it("accepts a valid issue with project/cycle omitted", () => {
    const result = IssueSchema.safeParse(validIssue());
    expect(result.success).toBe(true);
  });

  it("accepts an issue with optional project and cycle", () => {
    const result = IssueSchema.safeParse({
      ...validIssue(),
      project: "proj-1",
      cycle: "cycle-1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects priority below the minimum (0)", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects priority above the maximum (4)", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 5 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer priority", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 2.5 });
    expect(result.success).toBe(false);
  });

  it("rejects when a required field is missing", () => {
    const { id: _id, ...rest } = validIssue();
    const result = IssueSchema.safeParse(rest);
    expect(result.success).toBe(false);
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

  it("rejects when a required string field is missing", () => {
    const { defaultBranch: _db, ...rest } = validRepoConfig();
    expect(RepoConfigSchema.safeParse(rest).success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("accepts valid constraints", () => {
    expect(ConstraintsSchema.safeParse(validConstraints()).success).toBe(true);
  });

  it("rejects a non-positive maxFilesChanged", () => {
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: 0 }).success,
    ).toBe(false);
  });

  it("rejects a non-positive maxDiffLines", () => {
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints(), maxDiffLines: -1 }).success,
    ).toBe(false);
  });

  it("rejects a non-integer maxFilesChanged", () => {
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: 1.5 }).success,
    ).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a valid related issue without identifier/url", () => {
    expect(RelatedIssueSchema.safeParse(validRelatedIssue()).success).toBe(true);
  });

  it("accepts a related issue with identifier and url", () => {
    const result = RelatedIssueSchema.safeParse({
      ...validRelatedIssue(),
      identifier: "ENG-42",
      url: "https://example.com/ENG-42",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-range priority", () => {
    expect(RelatedIssueSchema.safeParse({ ...validRelatedIssue(), priority: 9 }).success).toBe(
      false,
    );
  });
});

describe("RelatedContextSchema", () => {
  it("accepts an empty blockers array with no parent", () => {
    expect(RelatedContextSchema.safeParse({ blockers: [] }).success).toBe(true);
  });

  it("accepts a parent and multiple blockers", () => {
    const result = RelatedContextSchema.safeParse({
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue(), validRelatedIssue()],
    });
    expect(result.success).toBe(true);
  });

  it("rejects when blockers is missing", () => {
    expect(RelatedContextSchema.safeParse({}).success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  function validBundle() {
    return {
      issue: validIssue(),
      repo: validRepoConfig(),
      constraints: validConstraints(),
      definitionOfDone: ["Tests pass"],
    };
  }

  it("accepts a valid bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse(validBundle());
    expect(result.success).toBe(true);
  });

  it("accepts a valid bundle with relatedContext", () => {
    const result = TaskBundleSchema.safeParse({
      ...validBundle(),
      relatedContext: { blockers: [validRelatedIssue()] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a bundle with an invalid nested issue", () => {
    const result = TaskBundleSchema.safeParse({
      ...validBundle(),
      issue: { ...validIssue(), priority: 99 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a bundle missing definitionOfDone", () => {
    const { definitionOfDone: _dod, ...rest } = validBundle();
    expect(TaskBundleSchema.safeParse(rest).success).toBe(false);
  });
});
