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

describe("IssueSchema", () => {
  it("accepts a well-formed issue", () => {
    expect(() => IssueSchema.parse(validIssue())).not.toThrow();
  });

  it("accepts optional project and cycle fields", () => {
    expect(() =>
      IssueSchema.parse({ ...validIssue(), project: "Core", cycle: "Sprint 1" }),
    ).not.toThrow();
  });

  it("rejects a priority outside the 0-4 range", () => {
    expect(() => IssueSchema.parse({ ...validIssue(), priority: 5 })).toThrow();
  });

  it("rejects a non-integer priority", () => {
    expect(() => IssueSchema.parse({ ...validIssue(), priority: 1.5 })).toThrow();
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a well-formed repo config", () => {
    expect(() => RepoConfigSchema.parse(validRepoConfig())).not.toThrow();
  });

  it("rejects a config missing required fields", () => {
    const { repoPath: _omit, ...rest } = validRepoConfig();
    expect(() => RepoConfigSchema.parse(rest)).toThrow();
  });
});

describe("ConstraintsSchema", () => {
  it("accepts well-formed constraints", () => {
    expect(() => ConstraintsSchema.parse(validConstraints())).not.toThrow();
  });

  it("rejects a non-positive maxFilesChanged", () => {
    expect(() => ConstraintsSchema.parse({ ...validConstraints(), maxFilesChanged: 0 })).toThrow();
  });

  it("rejects a non-positive maxDiffLines", () => {
    expect(() => ConstraintsSchema.parse({ ...validConstraints(), maxDiffLines: -1 })).toThrow();
  });
});

describe("RelatedIssueSchema / RelatedContextSchema", () => {
  it("accepts a related issue without the optional identifier/url", () => {
    const issue = {
      id: "b1",
      title: "Blocker",
      description: "Must finish first",
      state: "Todo",
      labels: [],
      priority: 1,
    };
    expect(() => RelatedIssueSchema.parse(issue)).not.toThrow();
  });

  it("accepts related context with a parent and blockers", () => {
    const related = {
      parent: {
        id: "p1",
        title: "Parent",
        description: "d",
        state: "In Progress",
        labels: [],
        priority: 2,
      },
      blockers: [
        { id: "b1", title: "Blocker", description: "d", state: "Todo", labels: [], priority: 1 },
      ],
    };
    expect(() => RelatedContextSchema.parse(related)).not.toThrow();
  });

  it("accepts related context with an empty blockers array and no parent", () => {
    expect(() => RelatedContextSchema.parse({ blockers: [] })).not.toThrow();
  });
});

describe("TaskBundleSchema", () => {
  it("accepts a full, well-formed task bundle", () => {
    const bundle = {
      issue: validIssue(),
      repo: validRepoConfig(),
      constraints: validConstraints(),
      definitionOfDone: ["Tests pass"],
    };
    const parsed = TaskBundleSchema.parse(bundle);
    expect(parsed.relatedContext).toBeUndefined();
  });

  it("accepts a task bundle with relatedContext attached", () => {
    const bundle = {
      issue: validIssue(),
      repo: validRepoConfig(),
      constraints: validConstraints(),
      definitionOfDone: ["Tests pass"],
      relatedContext: { blockers: [] },
    };
    expect(() => TaskBundleSchema.parse(bundle)).not.toThrow();
  });

  it("rejects a task bundle missing definitionOfDone", () => {
    const bundle = {
      issue: validIssue(),
      repo: validRepoConfig(),
      constraints: validConstraints(),
    };
    expect(() => TaskBundleSchema.parse(bundle)).toThrow();
  });
});
