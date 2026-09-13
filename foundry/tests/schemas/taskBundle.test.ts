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
    title: "Title",
    description: "Description",
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
    id: "b1",
    title: "Blocker",
    description: "Blocker desc",
    state: "Todo",
    labels: ["infra"],
    priority: 1,
  };
}

describe("IssueSchema", () => {
  it("parses a fully valid issue, including optional project/cycle", () => {
    const input = { ...validIssue(), project: "Proj", cycle: "Cycle 1" };
    const parsed = IssueSchema.parse(input);
    expect(parsed).toEqual(input);
  });

  it("parses a valid issue without the optional fields", () => {
    const parsed = IssueSchema.parse(validIssue());
    expect(parsed.project).toBeUndefined();
    expect(parsed.cycle).toBeUndefined();
  });

  it("rejects when a required field (title) is missing", () => {
    const { title: _title, ...rest } = validIssue();
    const result = IssueSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "title")).toBe(true);
    }
  });

  it("rejects when a field has the wrong type (labels not an array)", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), labels: "bug" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "labels")).toBe(true);
    }
  });

  it("rejects priority below the minimum (0)", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: -1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "priority")).toBe(true);
    }
  });

  it("rejects priority above the maximum (4)", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "priority")).toBe(true);
    }
  });

  it("rejects a non-integer priority", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 2.5 });
    expect(result.success).toBe(false);
  });

  it("accepts priority at both boundary values 0 and 4", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 0 }).success).toBe(true);
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 4 }).success).toBe(true);
  });
});

describe("RepoConfigSchema", () => {
  it("parses a fully valid repo config", () => {
    const parsed = RepoConfigSchema.parse(validRepo());
    expect(parsed).toEqual(validRepo());
  });

  it("rejects when a required field (repoPath) is missing", () => {
    const { repoPath: _repoPath, ...rest } = validRepo();
    const result = RepoConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "repoPath")).toBe(true);
    }
  });

  it("rejects when allowedPaths is the wrong type", () => {
    const result = RepoConfigSchema.safeParse({ ...validRepo(), allowedPaths: "src/" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "allowedPaths")).toBe(true);
    }
  });
});

describe("ConstraintsSchema", () => {
  it("parses fully valid constraints", () => {
    const parsed = ConstraintsSchema.parse(validConstraints());
    expect(parsed).toEqual(validConstraints());
  });

  it("rejects when a required field (maxFilesChanged) is missing", () => {
    const { maxFilesChanged: _m, ...rest } = validConstraints();
    const result = ConstraintsSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "maxFilesChanged")).toBe(true);
    }
  });

  it("rejects maxFilesChanged of zero (must be positive)", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative maxDiffLines", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxDiffLines: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer maxFilesChanged", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("parses a fully valid related issue including optional identifier/url", () => {
    const input = { ...validRelatedIssue(), identifier: "PRY-1", url: "https://example.com" };
    expect(RelatedIssueSchema.parse(input)).toEqual(input);
  });

  it("parses without the optional identifier/url fields", () => {
    const parsed = RelatedIssueSchema.parse(validRelatedIssue());
    expect(parsed.identifier).toBeUndefined();
    expect(parsed.url).toBeUndefined();
  });

  it("rejects when state is missing", () => {
    const { state: _state, ...rest } = validRelatedIssue();
    const result = RelatedIssueSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects priority out of range", () => {
    const result = RelatedIssueSchema.safeParse({ ...validRelatedIssue(), priority: 10 });
    expect(result.success).toBe(false);
  });
});

describe("RelatedContextSchema", () => {
  it("parses with a parent and blockers", () => {
    const input = { parent: validRelatedIssue(), blockers: [validRelatedIssue()] };
    expect(RelatedContextSchema.parse(input)).toEqual(input);
  });

  it("parses with an empty blockers array and no parent", () => {
    const parsed = RelatedContextSchema.parse({ blockers: [] });
    expect(parsed.parent).toBeUndefined();
    expect(parsed.blockers).toEqual([]);
  });

  it("rejects when blockers is missing (required field)", () => {
    const result = RelatedContextSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "blockers")).toBe(true);
    }
  });

  it("rejects an invalid parent object", () => {
    const result = RelatedContextSchema.safeParse({
      parent: { id: "p1" },
      blockers: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  function validBundle() {
    return {
      issue: validIssue(),
      repo: validRepo(),
      constraints: validConstraints(),
      definitionOfDone: ["All tests pass"],
    };
  }

  it("parses a valid bundle without optional relatedContext", () => {
    const parsed = TaskBundleSchema.parse(validBundle());
    expect(parsed.relatedContext).toBeUndefined();
    expect(parsed.issue).toEqual(validIssue());
  });

  it("parses a valid bundle with relatedContext included", () => {
    const input = {
      ...validBundle(),
      relatedContext: { blockers: [validRelatedIssue()] },
    };
    const parsed = TaskBundleSchema.parse(input);
    expect(parsed.relatedContext?.blockers).toHaveLength(1);
  });

  it("rejects when a top-level required field (definitionOfDone) is missing", () => {
    const { definitionOfDone: _d, ...rest } = validBundle();
    const result = TaskBundleSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "definitionOfDone")).toBe(true);
    }
  });

  it("rejects when a nested schema (issue) is invalid", () => {
    const result = TaskBundleSchema.safeParse({
      ...validBundle(),
      issue: { ...validIssue(), priority: 99 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "issue.priority")).toBe(true);
    }
  });

  it("rejects definitionOfDone with the wrong element type", () => {
    const result = TaskBundleSchema.safeParse({
      ...validBundle(),
      definitionOfDone: [1, 2, 3],
    });
    expect(result.success).toBe(false);
  });
});
