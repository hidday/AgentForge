import { describe, it, expect } from "vitest";
import {
  TaskBundleSchema,
  IssueSchema,
  RepoConfigSchema,
  ConstraintsSchema,
  RelatedIssueSchema,
  RelatedContextSchema,
} from "../../src/schemas/taskBundle.js";

function validIssue() {
  return {
    id: "LIN-1",
    title: "Fix the bug",
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
    title: "Parent issue",
    description: "desc",
    state: "Todo",
    labels: [],
    priority: 1,
  };
}

function validBundle() {
  return {
    issue: validIssue(),
    repo: validRepo(),
    constraints: validConstraints(),
    definitionOfDone: ["All tests pass"],
  };
}

describe("IssueSchema", () => {
  it("accepts a minimal valid issue", () => {
    const result = IssueSchema.safeParse(validIssue());
    expect(result.success).toBe(true);
  });

  it("accepts optional project and cycle fields", () => {
    const result = IssueSchema.safeParse({
      ...validIssue(),
      project: "Backend",
      cycle: "Sprint 1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a priority above the max boundary (4)", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 5 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative priority", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: -1 });
    expect(result.success).toBe(false);
  });

  it("accepts boundary priorities 0 and 4", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 0 }).success).toBe(true);
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 4 }).success).toBe(true);
  });

  it("rejects a non-integer priority", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects when a required field is missing", () => {
    const { title, ...rest } = validIssue();
    const result = IssueSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a valid repo config", () => {
    expect(RepoConfigSchema.safeParse(validRepo()).success).toBe(true);
  });

  it("rejects a repo config missing repoPath", () => {
    const { repoPath, ...rest } = validRepo();
    expect(RepoConfigSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects non-array allowedPaths", () => {
    const result = RepoConfigSchema.safeParse({ ...validRepo(), allowedPaths: "src/" });
    expect(result.success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("accepts valid constraints", () => {
    expect(ConstraintsSchema.safeParse(validConstraints()).success).toBe(true);
  });

  it("rejects a zero maxFilesChanged (must be positive)", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative maxDiffLines", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxDiffLines: -1 });
    expect(result.success).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a minimal related issue without identifier or url", () => {
    expect(RelatedIssueSchema.safeParse(validRelatedIssue()).success).toBe(true);
  });

  it("accepts a related issue with identifier and url", () => {
    const result = RelatedIssueSchema.safeParse({
      ...validRelatedIssue(),
      identifier: "PRY-100",
      url: "https://linear.app/team/issue/PRY-100",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-range priority", () => {
    const result = RelatedIssueSchema.safeParse({ ...validRelatedIssue(), priority: 9 });
    expect(result.success).toBe(false);
  });
});

describe("RelatedContextSchema", () => {
  it("accepts an empty blockers array with no parent", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("accepts a parent and multiple blockers", () => {
    const result = RelatedContextSchema.safeParse({
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue(), validRelatedIssue()],
    });
    expect(result.success).toBe(true);
  });

  it("rejects when blockers is missing (required field)", () => {
    const result = RelatedContextSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects a malformed blocker in the blockers array", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [{ id: "b1" }] });
    expect(result.success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  it("accepts a minimal valid task bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse(validBundle());
    expect(result.success).toBe(true);
  });

  it("accepts a task bundle including relatedContext", () => {
    const result = TaskBundleSchema.safeParse({
      ...validBundle(),
      relatedContext: { blockers: [validRelatedIssue()] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a task bundle missing the issue field", () => {
    const { issue, ...rest } = validBundle();
    const result = TaskBundleSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects a task bundle with an invalid nested constraints object", () => {
    const bundle = validBundle();
    const result = TaskBundleSchema.safeParse({
      ...bundle,
      constraints: { ...bundle.constraints, maxFilesChanged: -5 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a task bundle where definitionOfDone is not an array of strings", () => {
    const result = TaskBundleSchema.safeParse({ ...validBundle(), definitionOfDone: "done" });
    expect(result.success).toBe(false);
  });

  it("round-trips through parse() producing the same shape for a valid bundle", () => {
    const bundle = validBundle();
    const parsed = TaskBundleSchema.parse(bundle);
    expect(parsed.issue.id).toBe("LIN-1");
    expect(parsed.repo.name).toBe("acme/repo");
    expect(parsed.relatedContext).toBeUndefined();
  });

  it("throws via parse() for an invalid bundle", () => {
    expect(() => TaskBundleSchema.parse({})).toThrow();
  });
});
