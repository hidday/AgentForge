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
    title: "Fix bug",
    description: "Something is broken",
    labels: ["bug"],
    priority: 2,
  };
}

function validRepo() {
  return {
    name: "test-repo",
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
    labels: ["epic"],
    priority: 1,
    url: "https://linear.app/team/issue/PRY-100",
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
  it("accepts a fully populated issue", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), project: "proj", cycle: "cycle-1" });
    expect(result.success).toBe(true);
  });

  it("accepts an issue without the optional project/cycle fields", () => {
    const result = IssueSchema.safeParse(validIssue());
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

  it("accepts the boundary priority values 0 and 4", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 0 }).success).toBe(true);
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 4 }).success).toBe(true);
  });

  it("rejects a non-integer priority", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects when a required field is missing", () => {
    const { title: _title, ...rest } = validIssue();
    const result = IssueSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a valid repo config", () => {
    expect(RepoConfigSchema.safeParse(validRepo()).success).toBe(true);
  });

  it("rejects when allowedPaths is not an array", () => {
    const result = RepoConfigSchema.safeParse({ ...validRepo(), allowedPaths: "src/" });
    expect(result.success).toBe(false);
  });

  it("rejects when a required string field is missing", () => {
    const { repoPath: _repoPath, ...rest } = validRepo();
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
      ConstraintsSchema.safeParse({ ...validConstraints(), maxDiffLines: -5 }).success,
    ).toBe(false);
  });

  it("rejects a non-integer maxFilesChanged", () => {
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: 1.2 }).success,
    ).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a fully populated related issue", () => {
    expect(RelatedIssueSchema.safeParse(validRelatedIssue()).success).toBe(true);
  });

  it("accepts a related issue without optional identifier/url", () => {
    const { identifier: _identifier, url: _url, ...rest } = validRelatedIssue();
    expect(RelatedIssueSchema.safeParse(rest).success).toBe(true);
  });

  it("rejects priority outside the 0-4 range", () => {
    expect(
      RelatedIssueSchema.safeParse({ ...validRelatedIssue(), priority: 10 }).success,
    ).toBe(false);
  });

  it("rejects when state is missing", () => {
    const { state: _state, ...rest } = validRelatedIssue();
    expect(RelatedIssueSchema.safeParse(rest).success).toBe(false);
  });
});

describe("RelatedContextSchema", () => {
  it("accepts blockers only, with no parent", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [validRelatedIssue()] });
    expect(result.success).toBe(true);
  });

  it("accepts an empty blockers array", () => {
    expect(RelatedContextSchema.safeParse({ blockers: [] }).success).toBe(true);
  });

  it("accepts a parent plus blockers", () => {
    const result = RelatedContextSchema.safeParse({
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue()],
    });
    expect(result.success).toBe(true);
  });

  it("rejects when blockers is missing entirely", () => {
    expect(RelatedContextSchema.safeParse({ parent: validRelatedIssue() }).success).toBe(false);
  });

  it("rejects an invalid blocker entry", () => {
    const result = RelatedContextSchema.safeParse({
      blockers: [{ ...validRelatedIssue(), priority: "high" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  it("accepts a valid bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse(validBundle());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relatedContext).toBeUndefined();
    }
  });

  it("accepts a valid bundle with relatedContext", () => {
    const bundle = {
      ...validBundle(),
      relatedContext: { parent: validRelatedIssue(), blockers: [validRelatedIssue()] },
    };
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
  });

  it("rejects a bundle missing the issue field", () => {
    const { issue: _issue, ...rest } = validBundle();
    expect(TaskBundleSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a bundle missing definitionOfDone", () => {
    const { definitionOfDone: _dod, ...rest } = validBundle();
    expect(TaskBundleSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a bundle with an invalid nested repo config", () => {
    const bundle = { ...validBundle(), repo: { ...validRepo(), allowedPaths: "not-an-array" } };
    expect(TaskBundleSchema.safeParse(bundle).success).toBe(false);
  });

  it("rejects a bundle with an invalid relatedContext", () => {
    const bundle = { ...validBundle(), relatedContext: { parent: validRelatedIssue() } };
    expect(TaskBundleSchema.safeParse(bundle).success).toBe(false);
  });

  it("rejects a completely empty object", () => {
    expect(TaskBundleSchema.safeParse({}).success).toBe(false);
  });
});
