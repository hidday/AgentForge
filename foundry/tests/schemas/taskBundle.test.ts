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
    title: "Do the thing",
    description: "Full description",
    labels: ["bug"],
    priority: 2,
  };
}

function validRepo() {
  return {
    name: "acme/repo",
    defaultBranch: "main",
    workingBranch: "ai/lin-1",
    repoPath: "/workspace/repo",
    allowedPaths: ["src/"],
    protectedPaths: [".github/"],
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
    description: "desc",
    state: "In Progress",
    labels: ["epic"],
    priority: 1,
    url: "https://linear.app/x/issue/PRY-100",
  };
}

function validTaskBundle() {
  return {
    issue: validIssue(),
    repo: validRepo(),
    constraints: validConstraints(),
    definitionOfDone: ["All tests pass"],
  };
}

describe("IssueSchema", () => {
  it("parses a valid issue", () => {
    const result = IssueSchema.safeParse(validIssue());
    expect(result.success).toBe(true);
  });

  it("allows project and cycle to be omitted (optional)", () => {
    const result = IssueSchema.safeParse(validIssue());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project).toBeUndefined();
      expect(result.data.cycle).toBeUndefined();
    }
  });

  it("rejects a priority outside the 0-4 range", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 5 }).success).toBe(false);
    expect(IssueSchema.safeParse({ ...validIssue(), priority: -1 }).success).toBe(false);
  });

  it("rejects a non-integer priority", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 1.5 }).success).toBe(false);
  });

  it("rejects when a required field is missing", () => {
    const { title, ...rest } = validIssue();
    void title;
    expect(IssueSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects when labels is not an array of strings", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), labels: "bug" }).success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("parses a valid repo config", () => {
    expect(RepoConfigSchema.safeParse(validRepo()).success).toBe(true);
  });

  it("rejects when a required string field is missing", () => {
    const { repoPath, ...rest } = validRepo();
    void repoPath;
    expect(RepoConfigSchema.safeParse(rest).success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("parses valid constraints", () => {
    expect(ConstraintsSchema.safeParse(validConstraints()).success).toBe(true);
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

describe("RelatedIssueSchema", () => {
  it("parses a valid related issue with optional fields", () => {
    expect(RelatedIssueSchema.safeParse(validRelatedIssue()).success).toBe(true);
  });

  it("parses without identifier and url (optional)", () => {
    const { identifier, url, ...rest } = validRelatedIssue();
    void identifier;
    void url;
    expect(RelatedIssueSchema.safeParse(rest).success).toBe(true);
  });

  it("rejects an invalid priority", () => {
    expect(RelatedIssueSchema.safeParse({ ...validRelatedIssue(), priority: 10 }).success).toBe(
      false,
    );
  });
});

describe("RelatedContextSchema", () => {
  it("parses with a parent and blockers", () => {
    const result = RelatedContextSchema.safeParse({
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue()],
    });
    expect(result.success).toBe(true);
  });

  it("parses with no parent (optional) and empty blockers", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("rejects when blockers is missing", () => {
    expect(RelatedContextSchema.safeParse({}).success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  it("parses a fully valid task bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse(validTaskBundle());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relatedContext).toBeUndefined();
    }
  });

  it("parses a fully valid task bundle with relatedContext", () => {
    const bundle = {
      ...validTaskBundle(),
      relatedContext: { parent: validRelatedIssue(), blockers: [] },
    };
    expect(TaskBundleSchema.safeParse(bundle).success).toBe(true);
  });

  it("rejects when issue is invalid", () => {
    const bundle = { ...validTaskBundle(), issue: { ...validIssue(), priority: 99 } };
    expect(TaskBundleSchema.safeParse(bundle).success).toBe(false);
  });

  it("rejects when repo is missing", () => {
    const { repo, ...rest } = validTaskBundle();
    void repo;
    expect(TaskBundleSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects when constraints is invalid", () => {
    const bundle = {
      ...validTaskBundle(),
      constraints: { ...validConstraints(), maxFilesChanged: -1 },
    };
    expect(TaskBundleSchema.safeParse(bundle).success).toBe(false);
  });

  it("rejects when definitionOfDone is not an array", () => {
    const bundle = { ...validTaskBundle(), definitionOfDone: "done" };
    expect(TaskBundleSchema.safeParse(bundle).success).toBe(false);
  });
});
