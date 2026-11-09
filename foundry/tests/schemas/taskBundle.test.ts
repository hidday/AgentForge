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
    title: "Fix the bug",
    description: "There is a bug",
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
    protectedPaths: ["secrets/"],
  };
}

function validConstraints() {
  return {
    requiredChecks: ["lint", "test"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: ["TODO"],
    mustNotTouch: [".env"],
  };
}

function validRelatedIssue() {
  return {
    id: "p1",
    identifier: "PRY-100",
    title: "Parent issue",
    description: "Parent description",
    state: "In Progress",
    labels: ["epic"],
    priority: 1,
    url: "https://linear.app/team/issue/PRY-100",
  };
}

describe("IssueSchema", () => {
  it("parses a valid issue, including optional project/cycle", () => {
    const result = IssueSchema.parse({ ...validIssue(), project: "Project A", cycle: "Cycle 1" });
    expect(result).toMatchObject({ id: "LIN-1", project: "Project A", cycle: "Cycle 1" });
  });

  it("parses a valid issue without optional fields", () => {
    const result = IssueSchema.parse(validIssue());
    expect(result.project).toBeUndefined();
    expect(result.cycle).toBeUndefined();
  });

  it("rejects a priority above the max of 4", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 5 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative priority", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field (title)", () => {
    const { title: _title, ...withoutTitle } = validIssue();
    const result = IssueSchema.safeParse(withoutTitle);
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("parses a valid repo config", () => {
    expect(RepoConfigSchema.parse(validRepo())).toEqual(validRepo());
  });

  it("rejects a missing required field (repoPath)", () => {
    const { repoPath: _repoPath, ...withoutRepoPath } = validRepo();
    expect(RepoConfigSchema.safeParse(withoutRepoPath).success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("parses valid constraints", () => {
    expect(ConstraintsSchema.parse(validConstraints())).toEqual(validConstraints());
  });

  it("rejects a non-positive maxFilesChanged", () => {
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: 0 }).success,
    ).toBe(false);
  });

  it("rejects a non-integer maxDiffLines", () => {
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints(), maxDiffLines: 1.5 }).success,
    ).toBe(false);
  });
});

describe("RelatedIssueSchema / RelatedContextSchema", () => {
  it("parses a valid related issue with optional identifier/url", () => {
    expect(RelatedIssueSchema.parse(validRelatedIssue())).toMatchObject({ identifier: "PRY-100" });
  });

  it("parses a valid related issue without optional identifier/url", () => {
    const { identifier: _identifier, url: _url, ...minimal } = validRelatedIssue();
    const result = RelatedIssueSchema.parse(minimal);
    expect(result.identifier).toBeUndefined();
    expect(result.url).toBeUndefined();
  });

  it("rejects a related issue with an out-of-range priority", () => {
    expect(
      RelatedIssueSchema.safeParse({ ...validRelatedIssue(), priority: 10 }).success,
    ).toBe(false);
  });

  it("parses a RelatedContext with a parent and blockers", () => {
    const result = RelatedContextSchema.parse({
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue()],
    });
    expect(result.blockers).toHaveLength(1);
    expect(result.parent?.id).toBe("p1");
  });

  it("parses a RelatedContext with no parent (optional) but blockers required as an array", () => {
    const result = RelatedContextSchema.parse({ blockers: [] });
    expect(result.parent).toBeUndefined();
    expect(result.blockers).toEqual([]);
  });

  it("rejects a RelatedContext missing the required blockers array", () => {
    expect(RelatedContextSchema.safeParse({}).success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  function validBundle() {
    return {
      issue: validIssue(),
      repo: validRepo(),
      constraints: validConstraints(),
      definitionOfDone: ["Tests pass", "Lint passes"],
    };
  }

  it("parses a full valid task bundle without relatedContext (optional)", () => {
    const result = TaskBundleSchema.parse(validBundle());
    expect(result.relatedContext).toBeUndefined();
    expect(result.issue.id).toBe("LIN-1");
    expect(result.definitionOfDone).toEqual(["Tests pass", "Lint passes"]);
  });

  it("parses a full valid task bundle with relatedContext present", () => {
    const bundle = {
      ...validBundle(),
      relatedContext: { parent: validRelatedIssue(), blockers: [validRelatedIssue()] },
    };
    const result = TaskBundleSchema.parse(bundle);
    expect(result.relatedContext?.blockers).toHaveLength(1);
  });

  it("rejects a bundle missing the required issue field", () => {
    const { issue: _issue, ...withoutIssue } = validBundle();
    expect(TaskBundleSchema.safeParse(withoutIssue).success).toBe(false);
  });

  it("rejects a bundle with an invalid nested constraints shape", () => {
    const bundle = { ...validBundle(), constraints: { ...validConstraints(), maxFilesChanged: -1 } };
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects a bundle whose definitionOfDone is not an array of strings", () => {
    const bundle = { ...validBundle(), definitionOfDone: "not an array" };
    expect(TaskBundleSchema.safeParse(bundle).success).toBe(false);
  });
});
