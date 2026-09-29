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
  id: "issue-1",
  title: "Fix the bug",
  description: "Something is broken",
  labels: ["bug"],
  priority: 2,
};

const validRepo = {
  name: "svc-a",
  defaultBranch: "main",
  workingBranch: "feature/issue-1",
  repoPath: "/repos/svc-a",
  allowedPaths: ["src/"],
  protectedPaths: ["src/generated/"],
};

const validConstraints = {
  requiredChecks: ["lint", "test"],
  maxFilesChanged: 10,
  maxDiffLines: 500,
  forbiddenPatterns: [],
  mustNotTouch: [],
};

const validRelatedIssue = {
  id: "issue-parent",
  title: "Parent issue",
  description: "Parent description",
  state: "in_progress",
  labels: [],
  priority: 1,
};

const validBundle = {
  issue: validIssue,
  repo: validRepo,
  constraints: validConstraints,
  definitionOfDone: ["Tests pass"],
};

describe("IssueSchema", () => {
  it("parses a valid issue", () => {
    expect(IssueSchema.parse(validIssue)).toEqual(validIssue);
  });

  it("accepts optional project and cycle fields", () => {
    const withOptional = { ...validIssue, project: "proj-1", cycle: "cycle-1" };
    expect(IssueSchema.parse(withOptional)).toEqual(withOptional);
  });

  it("rejects a missing required field", () => {
    const { title: _title, ...missingTitle } = validIssue;
    expect(IssueSchema.safeParse(missingTitle).success).toBe(false);
  });

  it("rejects a priority outside the 0-4 range", () => {
    expect(IssueSchema.safeParse({ ...validIssue, priority: 5 }).success).toBe(false);
    expect(IssueSchema.safeParse({ ...validIssue, priority: -1 }).success).toBe(false);
  });

  it("rejects a non-integer priority", () => {
    expect(IssueSchema.safeParse({ ...validIssue, priority: 1.5 }).success).toBe(false);
  });

  it("rejects the wrong type for labels", () => {
    expect(IssueSchema.safeParse({ ...validIssue, labels: "bug" }).success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("parses a valid repo config", () => {
    expect(RepoConfigSchema.parse(validRepo)).toEqual(validRepo);
  });

  it("rejects a missing required field", () => {
    const { repoPath: _repoPath, ...missing } = validRepo;
    expect(RepoConfigSchema.safeParse(missing).success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("parses valid constraints", () => {
    expect(ConstraintsSchema.parse(validConstraints)).toEqual(validConstraints);
  });

  it("rejects a non-positive maxFilesChanged", () => {
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints, maxFilesChanged: 0 }).success,
    ).toBe(false);
  });

  it("rejects a non-positive maxDiffLines", () => {
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints, maxDiffLines: -5 }).success,
    ).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("parses a valid related issue", () => {
    expect(RelatedIssueSchema.parse(validRelatedIssue)).toEqual(validRelatedIssue);
  });

  it("accepts optional identifier and url", () => {
    const withOptional = { ...validRelatedIssue, identifier: "ENG-1", url: "https://example.com" };
    expect(RelatedIssueSchema.parse(withOptional)).toEqual(withOptional);
  });

  it("rejects a missing required field", () => {
    const { state: _state, ...missing } = validRelatedIssue;
    expect(RelatedIssueSchema.safeParse(missing).success).toBe(false);
  });
});

describe("RelatedContextSchema", () => {
  it("parses with both parent and blockers", () => {
    const context = { parent: validRelatedIssue, blockers: [validRelatedIssue] };
    expect(RelatedContextSchema.parse(context)).toEqual(context);
  });

  it("parses with parent omitted", () => {
    const context = { blockers: [] };
    expect(RelatedContextSchema.parse(context)).toEqual(context);
  });

  it("rejects a missing blockers field", () => {
    expect(RelatedContextSchema.safeParse({ parent: validRelatedIssue }).success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  it("parses a fully valid task bundle without relatedContext", () => {
    const result = TaskBundleSchema.parse(validBundle);
    expect(result).toEqual(validBundle);
  });

  it("parses a fully valid task bundle with relatedContext", () => {
    const bundle = {
      ...validBundle,
      relatedContext: { parent: validRelatedIssue, blockers: [validRelatedIssue] },
    };
    expect(TaskBundleSchema.parse(bundle)).toEqual(bundle);
  });

  it("fails when a required top-level field is missing", () => {
    const { constraints: _constraints, ...missing } = validBundle;
    const result = TaskBundleSchema.safeParse(missing);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("constraints"))).toBe(true);
    }
  });

  it("fails when a nested field has the wrong type", () => {
    const invalid = { ...validBundle, issue: { ...validIssue, priority: "high" } };
    const result = TaskBundleSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("fails when definitionOfDone is not an array", () => {
    const invalid = { ...validBundle, definitionOfDone: "done" };
    expect(TaskBundleSchema.safeParse(invalid).success).toBe(false);
  });
});
