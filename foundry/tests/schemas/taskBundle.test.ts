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
    workingBranch: "ai/feature",
    repoPath: "/repos/acme",
    allowedPaths: ["src/"],
    protectedPaths: [".github/"],
  };
}

function validConstraints() {
  return {
    requiredChecks: ["lint"],
    maxFilesChanged: 10,
    maxDiffLines: 1000,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };
}

describe("IssueSchema", () => {
  it("accepts a valid issue and parses optional fields as undefined when absent", () => {
    const parsed = IssueSchema.parse(validIssue());
    expect(parsed.project).toBeUndefined();
    expect(parsed.cycle).toBeUndefined();
  });

  it("rejects a priority outside the 0-4 range", () => {
    expect(() => IssueSchema.parse({ ...validIssue(), priority: 5 })).toThrow();
    expect(() => IssueSchema.parse({ ...validIssue(), priority: -1 })).toThrow();
  });

  it("rejects a non-integer priority", () => {
    expect(() => IssueSchema.parse({ ...validIssue(), priority: 1.5 })).toThrow();
  });

  it("rejects a missing required field", () => {
    const { title, ...rest } = validIssue();
    expect(() => IssueSchema.parse(rest)).toThrow();
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a valid repo config", () => {
    expect(() => RepoConfigSchema.parse(validRepo())).not.toThrow();
  });

  it("rejects when allowedPaths is not an array of strings", () => {
    expect(() => RepoConfigSchema.parse({ ...validRepo(), allowedPaths: "src/" })).toThrow();
  });
});

describe("ConstraintsSchema", () => {
  it("accepts valid constraints", () => {
    expect(() => ConstraintsSchema.parse(validConstraints())).not.toThrow();
  });

  it("rejects a zero or negative maxFilesChanged", () => {
    expect(() => ConstraintsSchema.parse({ ...validConstraints(), maxFilesChanged: 0 })).toThrow();
    expect(() => ConstraintsSchema.parse({ ...validConstraints(), maxFilesChanged: -1 })).toThrow();
  });

  it("rejects a non-integer maxDiffLines", () => {
    expect(() => ConstraintsSchema.parse({ ...validConstraints(), maxDiffLines: 1.5 })).toThrow();
  });
});

describe("RelatedIssueSchema and RelatedContextSchema", () => {
  it("accepts a related issue with no url/identifier (optional fields)", () => {
    const parsed = RelatedIssueSchema.parse({
      id: "LIN-2",
      title: "Parent",
      description: "desc",
      state: "Todo",
      labels: [],
      priority: 0,
    });
    expect(parsed.url).toBeUndefined();
  });

  it("accepts a context with a parent and blockers, and one with blockers only", () => {
    const related = {
      id: "LIN-2",
      title: "Related",
      description: "desc",
      state: "Todo",
      labels: [],
      priority: 0,
    };
    expect(() => RelatedContextSchema.parse({ parent: related, blockers: [related] })).not.toThrow();
    expect(() => RelatedContextSchema.parse({ blockers: [] })).not.toThrow();
  });
});

describe("TaskBundleSchema", () => {
  it("accepts a full valid bundle including optional relatedContext", () => {
    const bundle = {
      issue: validIssue(),
      repo: validRepo(),
      constraints: validConstraints(),
      definitionOfDone: ["Tests pass"],
      relatedContext: { blockers: [] },
    };
    expect(() => TaskBundleSchema.parse(bundle)).not.toThrow();
  });

  it("accepts a bundle without relatedContext (optional)", () => {
    const bundle = {
      issue: validIssue(),
      repo: validRepo(),
      constraints: validConstraints(),
      definitionOfDone: [],
    };
    const parsed = TaskBundleSchema.parse(bundle);
    expect(parsed.relatedContext).toBeUndefined();
  });

  it("rejects a bundle with an invalid nested issue", () => {
    const bundle = {
      issue: { ...validIssue(), priority: 99 },
      repo: validRepo(),
      constraints: validConstraints(),
      definitionOfDone: [],
    };
    expect(() => TaskBundleSchema.parse(bundle)).toThrow();
  });

  it("rejects a bundle missing definitionOfDone", () => {
    const { issue, repo, constraints } = {
      issue: validIssue(),
      repo: validRepo(),
      constraints: validConstraints(),
    };
    expect(() => TaskBundleSchema.parse({ issue, repo, constraints })).toThrow();
  });
});
