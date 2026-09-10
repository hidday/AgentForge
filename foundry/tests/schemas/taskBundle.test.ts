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
    description: "A description",
    labels: ["bug"],
    priority: 2,
    project: "proj-1",
    cycle: "cycle-1",
  };
}

function validRepoConfig() {
  return {
    name: "test-repo",
    defaultBranch: "main",
    workingBranch: "ai/lin-1",
    repoPath: "/tmp/repo",
    allowedPaths: ["src/"],
    protectedPaths: ["src/secrets/"],
  };
}

function validConstraints() {
  return {
    requiredChecks: ["lint", "test"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: ["TODO"],
    mustNotTouch: ["package.json"],
  };
}

function validRelatedIssue() {
  return {
    id: "LIN-2",
    identifier: "LIN-2",
    title: "Parent issue",
    description: "Parent description",
    state: "In Progress",
    labels: ["epic"],
    priority: 1,
    url: "https://linear.app/issue/LIN-2",
  };
}

function validRelatedContext() {
  return {
    parent: validRelatedIssue(),
    blockers: [validRelatedIssue()],
  };
}

function validTaskBundle() {
  return {
    issue: validIssue(),
    repo: validRepoConfig(),
    constraints: validConstraints(),
    definitionOfDone: ["Tests pass"],
    relatedContext: validRelatedContext(),
  };
}

describe("IssueSchema", () => {
  it("parses a fully valid issue", () => {
    const result = IssueSchema.safeParse(validIssue());
    expect(result.success).toBe(true);
  });

  it("rejects a non-integer priority (float)", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 2.5 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeDefined();
  });

  it("rejects an out-of-range priority", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 5 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeDefined();
  });

  it("rejects a negative priority", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field (title)", () => {
    const { title: _title, ...rest } = validIssue();
    const result = IssueSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeDefined();
  });

  it("allows project and cycle to be omitted (optional)", () => {
    const { project: _p, cycle: _c, ...rest } = validIssue();
    const result = IssueSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });
});

describe("RepoConfigSchema", () => {
  it("parses a fully valid repo config", () => {
    const result = RepoConfigSchema.safeParse(validRepoConfig());
    expect(result.success).toBe(true);
  });

  it("rejects a missing required field (name)", () => {
    const { name: _name, ...rest } = validRepoConfig();
    const result = RepoConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeDefined();
  });

  it("rejects wrong types for array fields", () => {
    const result = RepoConfigSchema.safeParse({ ...validRepoConfig(), allowedPaths: "src/" });
    expect(result.success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("parses fully valid constraints", () => {
    const result = ConstraintsSchema.safeParse(validConstraints());
    expect(result.success).toBe(true);
  });

  it("rejects maxFilesChanged of zero", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: 0 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeDefined();
  });

  it("rejects a negative maxFilesChanged", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: -5 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative maxDiffLines", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxDiffLines: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field (forbiddenPatterns)", () => {
    const { forbiddenPatterns: _fp, ...rest } = validConstraints();
    const result = ConstraintsSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("parses a fully valid related issue", () => {
    const result = RelatedIssueSchema.safeParse(validRelatedIssue());
    expect(result.success).toBe(true);
  });

  it("allows identifier and url to be omitted", () => {
    const { identifier: _i, url: _u, ...rest } = validRelatedIssue();
    const result = RelatedIssueSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-range priority", () => {
    const result = RelatedIssueSchema.safeParse({ ...validRelatedIssue(), priority: 10 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeDefined();
  });

  it("rejects a missing required field (state)", () => {
    const { state: _s, ...rest } = validRelatedIssue();
    const result = RelatedIssueSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("RelatedContextSchema", () => {
  it("parses with both parent and non-empty blockers", () => {
    const result = RelatedContextSchema.safeParse(validRelatedContext());
    expect(result.success).toBe(true);
  });

  it("parses with a parent but an empty blockers array", () => {
    const result = RelatedContextSchema.safeParse({ parent: validRelatedIssue(), blockers: [] });
    expect(result.success).toBe(true);
  });

  it("parses with no parent at all (parent optional)", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("rejects when blockers is missing", () => {
    const result = RelatedContextSchema.safeParse({ parent: validRelatedIssue() });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeDefined();
  });
});

describe("TaskBundleSchema", () => {
  it("parses a fully valid task bundle", () => {
    const result = TaskBundleSchema.safeParse(validTaskBundle());
    expect(result.success).toBe(true);
  });

  it("parses successfully without relatedContext (it is optional)", () => {
    const { relatedContext: _rc, ...rest } = validTaskBundle();
    const result = TaskBundleSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it("rejects a bundle with an invalid nested issue", () => {
    const bundle = validTaskBundle();
    const result = TaskBundleSchema.safeParse({
      ...bundle,
      issue: { ...bundle.issue, priority: 99 },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeDefined();
  });

  it("rejects a bundle missing a required top-level field (constraints)", () => {
    const { constraints: _c, ...rest } = validTaskBundle();
    const result = TaskBundleSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeDefined();
  });

  it("rejects a bundle with an invalid relatedContext", () => {
    const bundle = validTaskBundle();
    const result = TaskBundleSchema.safeParse({
      ...bundle,
      relatedContext: { parent: validRelatedIssue() }, // missing blockers
    });
    expect(result.success).toBe(false);
  });
});
