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
    name: "acme/backend",
    defaultBranch: "main",
    workingBranch: "ai/lin-1",
    repoPath: "/tmp/acme",
    allowedPaths: ["src/"],
    protectedPaths: [".github/"],
  };
}

function validConstraints() {
  return {
    requiredChecks: ["lint", "test"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: ["eval\\("],
    mustNotTouch: ["prisma/migrations/"],
  };
}

function validRelatedIssue() {
  return {
    id: "p1",
    identifier: "PRY-100",
    title: "Parent",
    description: "Parent description",
    state: "In Progress",
    labels: ["epic"],
    priority: 1,
    url: "https://linear.app/team/issue/PRY-100",
  };
}

describe("IssueSchema", () => {
  it("accepts a valid issue, defaulting optional fields to undefined", () => {
    const result = IssueSchema.safeParse(validIssue());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project).toBeUndefined();
      expect(result.data.cycle).toBeUndefined();
    }
  });

  it("accepts optional project and cycle when provided", () => {
    const result = IssueSchema.safeParse({
      ...validIssue(),
      project: "Backend Platform",
      cycle: "Sprint 23",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a priority outside the 0-4 range", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 5 }).success).toBe(false);
    expect(IssueSchema.safeParse({ ...validIssue(), priority: -1 }).success).toBe(false);
  });

  it("rejects a non-integer priority", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 1.5 }).success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { title: _title, ...withoutTitle } = validIssue();
    expect(IssueSchema.safeParse(withoutTitle).success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a valid repo config", () => {
    expect(RepoConfigSchema.safeParse(validRepo()).success).toBe(true);
  });

  it("rejects a non-array allowedPaths", () => {
    expect(RepoConfigSchema.safeParse({ ...validRepo(), allowedPaths: "src/" }).success).toBe(
      false,
    );
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
      ConstraintsSchema.safeParse({ ...validConstraints(), maxDiffLines: -5 }).success,
    ).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a valid related issue with optional fields present", () => {
    expect(RelatedIssueSchema.safeParse(validRelatedIssue()).success).toBe(true);
  });

  it("accepts a related issue without identifier or url", () => {
    const { identifier: _identifier, url: _url, ...rest } = validRelatedIssue();
    expect(RelatedIssueSchema.safeParse(rest).success).toBe(true);
  });

  it("rejects an invalid priority", () => {
    expect(RelatedIssueSchema.safeParse({ ...validRelatedIssue(), priority: 10 }).success).toBe(
      false,
    );
  });
});

describe("RelatedContextSchema", () => {
  it("accepts blockers-only context with no parent", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [validRelatedIssue()] });
    expect(result.success).toBe(true);
  });

  it("accepts context with both parent and blockers", () => {
    const result = RelatedContextSchema.safeParse({
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue(), validRelatedIssue()],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing blockers array", () => {
    expect(RelatedContextSchema.safeParse({ parent: validRelatedIssue() }).success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  function validBundle() {
    return {
      issue: validIssue(),
      repo: validRepo(),
      constraints: validConstraints(),
      definitionOfDone: ["All tests pass", "Lint is clean"],
    };
  }

  it("accepts a full valid task bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse(validBundle());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relatedContext).toBeUndefined();
    }
  });

  it("accepts a task bundle with relatedContext", () => {
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
    const { definitionOfDone: _dod, ...withoutDod } = validBundle();
    expect(TaskBundleSchema.safeParse(withoutDod).success).toBe(false);
  });
});
