import { describe, it, expect } from "vitest";
import {
  IssueSchema,
  RepoConfigSchema,
  ConstraintsSchema,
  RelatedIssueSchema,
  RelatedContextSchema,
  TaskBundleSchema,
} from "../../src/schemas/taskBundle.js";

const validIssue = {
  id: "ISSUE-1",
  title: "Fix bug",
  description: "A bug needs fixing",
  labels: ["bug"],
  priority: 2,
};

const validRepo = {
  name: "agentforge",
  defaultBranch: "main",
  workingBranch: "feature/x",
  repoPath: "/repo",
  allowedPaths: ["src/"],
  protectedPaths: [],
};

const validConstraints = {
  requiredChecks: ["ci"],
  maxFilesChanged: 5,
  maxDiffLines: 200,
  forbiddenPatterns: [],
  mustNotTouch: [],
};

describe("IssueSchema", () => {
  it("accepts a valid issue without optional fields", () => {
    expect(IssueSchema.parse(validIssue)).toEqual(validIssue);
  });

  it("accepts a valid issue with optional project and cycle", () => {
    const withOptional = { ...validIssue, project: "proj", cycle: "cycle-1" };
    expect(IssueSchema.parse(withOptional)).toEqual(withOptional);
  });

  it("rejects a priority outside the 0-4 range", () => {
    expect(() => IssueSchema.parse({ ...validIssue, priority: 5 })).toThrow();
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a valid repo config", () => {
    expect(RepoConfigSchema.parse(validRepo)).toEqual(validRepo);
  });

  it("rejects a repo config missing required fields", () => {
    const { repoPath: _omit, ...incomplete } = validRepo;
    expect(() => RepoConfigSchema.parse(incomplete)).toThrow();
  });
});

describe("ConstraintsSchema", () => {
  it("accepts valid constraints", () => {
    expect(ConstraintsSchema.parse(validConstraints)).toEqual(validConstraints);
  });

  it("rejects a non-positive maxFilesChanged", () => {
    expect(() => ConstraintsSchema.parse({ ...validConstraints, maxFilesChanged: 0 })).toThrow();
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a related issue with only required fields", () => {
    const issue = {
      id: "ISSUE-2",
      title: "Blocker",
      description: "blocks the main issue",
      state: "open",
      labels: [],
      priority: 1,
    };
    expect(RelatedIssueSchema.parse(issue)).toEqual(issue);
  });

  it("accepts optional identifier and url", () => {
    const issue = {
      id: "ISSUE-2",
      identifier: "AF-2",
      title: "Blocker",
      description: "blocks the main issue",
      state: "open",
      labels: [],
      priority: 1,
      url: "https://example.com/AF-2",
    };
    expect(RelatedIssueSchema.parse(issue)).toEqual(issue);
  });
});

describe("RelatedContextSchema", () => {
  it("accepts an empty blockers list with no parent", () => {
    const context = { blockers: [] };
    expect(RelatedContextSchema.parse(context)).toEqual(context);
  });
});

describe("TaskBundleSchema", () => {
  it("accepts a full task bundle without relatedContext", () => {
    const bundle = {
      issue: validIssue,
      repo: validRepo,
      constraints: validConstraints,
      definitionOfDone: ["tests pass"],
    };
    expect(TaskBundleSchema.parse(bundle)).toEqual(bundle);
  });

  it("accepts a full task bundle with relatedContext", () => {
    const bundle = {
      issue: validIssue,
      repo: validRepo,
      constraints: validConstraints,
      definitionOfDone: ["tests pass"],
      relatedContext: { blockers: [] },
    };
    expect(TaskBundleSchema.parse(bundle)).toEqual(bundle);
  });

  it("rejects a bundle missing a required top-level field", () => {
    const bundle = {
      issue: validIssue,
      repo: validRepo,
      constraints: validConstraints,
    };
    expect(() => TaskBundleSchema.parse(bundle)).toThrow();
  });
});
