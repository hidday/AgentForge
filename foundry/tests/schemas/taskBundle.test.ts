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

function validRepo() {
  return {
    name: "acme/repo",
    defaultBranch: "main",
    workingBranch: "ai/lin-1",
    repoPath: "/tmp/repo",
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
    id: "p1",
    identifier: "PRY-100",
    title: "Parent",
    description: "Parent desc",
    state: "In Progress",
    labels: [],
    priority: 1,
    url: "https://linear.app/x",
  };
}

function validBundle() {
  return {
    issue: validIssue(),
    repo: validRepo(),
    constraints: validConstraints(),
    definitionOfDone: ["Tests pass"],
  };
}

describe("IssueSchema", () => {
  it("accepts a valid issue", () => {
    expect(IssueSchema.safeParse(validIssue()).success).toBe(true);
  });

  it("allows project and cycle to be omitted (optional)", () => {
    const result = IssueSchema.safeParse(validIssue());
    expect(result.success).toBe(true);
  });

  it("accepts priority at the boundaries 0 and 4", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 0 }).success).toBe(true);
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 4 }).success).toBe(true);
  });

  it("rejects priority below 0", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), priority: -1 }).success).toBe(false);
  });

  it("rejects priority above 4", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 5 }).success).toBe(false);
  });

  it("rejects a non-integer priority", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 1.5 }).success).toBe(false);
  });

  it("rejects when a required field is missing", () => {
    const { title, ...rest } = validIssue();
    expect(IssueSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects when labels is not an array of strings", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), labels: "bug" }).success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a valid repo config", () => {
    expect(RepoConfigSchema.safeParse(validRepo()).success).toBe(true);
  });

  it("rejects when a required field is missing", () => {
    const { repoPath, ...rest } = validRepo();
    expect(RepoConfigSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects when allowedPaths is not an array", () => {
    expect(RepoConfigSchema.safeParse({ ...validRepo(), allowedPaths: "src/" }).success).toBe(
      false,
    );
  });
});

describe("ConstraintsSchema", () => {
  it("accepts valid constraints", () => {
    expect(ConstraintsSchema.safeParse(validConstraints()).success).toBe(true);
  });

  it("rejects maxFilesChanged of 0 (must be positive)", () => {
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: 0 }).success,
    ).toBe(false);
  });

  it("rejects a non-integer maxDiffLines", () => {
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints(), maxDiffLines: 1.5 }).success,
    ).toBe(false);
  });

  it("rejects negative maxFilesChanged", () => {
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: -5 }).success,
    ).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a valid related issue with optional fields present", () => {
    expect(RelatedIssueSchema.safeParse(validRelatedIssue()).success).toBe(true);
  });

  it("accepts a related issue with identifier and url omitted", () => {
    const { identifier, url, ...rest } = validRelatedIssue();
    expect(RelatedIssueSchema.safeParse(rest).success).toBe(true);
  });

  it("rejects when state is missing", () => {
    const { state, ...rest } = validRelatedIssue();
    expect(RelatedIssueSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects priority outside 0-4", () => {
    expect(RelatedIssueSchema.safeParse({ ...validRelatedIssue(), priority: 10 }).success).toBe(
      false,
    );
  });
});

describe("RelatedContextSchema", () => {
  it("accepts parent and blockers together", () => {
    const result = RelatedContextSchema.safeParse({
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue()],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty blockers array with no parent", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("rejects when blockers is missing (required)", () => {
    const result = RelatedContextSchema.safeParse({ parent: validRelatedIssue() });
    expect(result.success).toBe(false);
  });

  it("rejects when a blocker in the array is invalid", () => {
    const { title, ...invalidBlocker } = validRelatedIssue();
    const result = RelatedContextSchema.safeParse({ blockers: [invalidBlocker] });
    expect(result.success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  it("accepts a minimal valid bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse(validBundle());
    expect(result.success).toBe(true);
  });

  it("accepts a full bundle including relatedContext", () => {
    const result = TaskBundleSchema.safeParse({
      ...validBundle(),
      relatedContext: { parent: validRelatedIssue(), blockers: [validRelatedIssue()] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects when issue is invalid", () => {
    const result = TaskBundleSchema.safeParse({
      ...validBundle(),
      issue: { ...validIssue(), priority: 99 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects when definitionOfDone is missing", () => {
    const { definitionOfDone, ...rest } = validBundle();
    expect(TaskBundleSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects when repo is missing entirely", () => {
    const { repo, ...rest } = validBundle();
    expect(TaskBundleSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a non-object input", () => {
    expect(TaskBundleSchema.safeParse(null).success).toBe(false);
    expect(TaskBundleSchema.safeParse("bundle").success).toBe(false);
  });
});
