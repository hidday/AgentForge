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
  id: "ENG-1",
  title: "Fix the bug",
  description: "Detailed description",
  labels: ["bug"],
  priority: 2,
};

const validRepo = {
  name: "acme/repo",
  defaultBranch: "main",
  workingBranch: "feature/eng-1",
  repoPath: "/repos/acme",
  allowedPaths: ["src/"],
  protectedPaths: [".github/"],
};

const validConstraints = {
  requiredChecks: ["lint", "test"],
  maxFilesChanged: 10,
  maxDiffLines: 500,
  forbiddenPatterns: ["eval("],
  mustNotTouch: ["prisma/migrations/"],
};

const validRelatedIssue = {
  id: "ENG-0",
  title: "Parent issue",
  description: "Parent description",
  state: "In Progress",
  labels: ["epic"],
  priority: 1,
};

describe("IssueSchema", () => {
  it("parses a well-formed issue", () => {
    expect(IssueSchema.parse(validIssue)).toEqual(validIssue);
  });

  it("accepts optional project and cycle fields", () => {
    const withOptional = { ...validIssue, project: "Platform", cycle: "Sprint 1" };
    expect(IssueSchema.parse(withOptional)).toEqual(withOptional);
  });

  it("parses when project/cycle are omitted (optional fields)", () => {
    const result = IssueSchema.parse(validIssue);
    expect(result.project).toBeUndefined();
    expect(result.cycle).toBeUndefined();
  });

  it("rejects a priority below the minimum (0)", () => {
    expect(() => IssueSchema.parse({ ...validIssue, priority: -1 })).toThrow();
  });

  it("rejects a priority above the maximum (4)", () => {
    expect(() => IssueSchema.parse({ ...validIssue, priority: 5 })).toThrow();
  });

  it("accepts the boundary priority values 0 and 4", () => {
    expect(IssueSchema.parse({ ...validIssue, priority: 0 }).priority).toBe(0);
    expect(IssueSchema.parse({ ...validIssue, priority: 4 }).priority).toBe(4);
  });

  it("rejects a non-integer priority", () => {
    expect(() => IssueSchema.parse({ ...validIssue, priority: 2.5 })).toThrow();
  });

  it("rejects when labels is not an array", () => {
    expect(() => IssueSchema.parse({ ...validIssue, labels: "bug" })).toThrow();
  });

  it("rejects when a required field (title) is missing", () => {
    const { title, ...rest } = validIssue;
    expect(() => IssueSchema.parse(rest)).toThrow();
  });

  it("rejects when id is not a string", () => {
    expect(() => IssueSchema.parse({ ...validIssue, id: 42 })).toThrow();
  });
});

describe("RepoConfigSchema", () => {
  it("parses a well-formed repo config", () => {
    expect(RepoConfigSchema.parse(validRepo)).toEqual(validRepo);
  });

  it("rejects when allowedPaths is missing", () => {
    const { allowedPaths, ...rest } = validRepo;
    expect(() => RepoConfigSchema.parse(rest)).toThrow();
  });

  it("rejects when protectedPaths contains non-string entries", () => {
    expect(() => RepoConfigSchema.parse({ ...validRepo, protectedPaths: [123] })).toThrow();
  });

  it("rejects when workingBranch is missing (no default, unlike repoRegistry's defaultBranch)", () => {
    const { workingBranch, ...rest } = validRepo;
    expect(() => RepoConfigSchema.parse(rest)).toThrow();
  });
});

describe("ConstraintsSchema", () => {
  it("parses well-formed constraints", () => {
    expect(ConstraintsSchema.parse(validConstraints)).toEqual(validConstraints);
  });

  it("rejects maxFilesChanged of zero (must be positive)", () => {
    expect(() => ConstraintsSchema.parse({ ...validConstraints, maxFilesChanged: 0 })).toThrow();
  });

  it("rejects a negative maxDiffLines", () => {
    expect(() => ConstraintsSchema.parse({ ...validConstraints, maxDiffLines: -1 })).toThrow();
  });

  it("rejects a non-integer maxFilesChanged", () => {
    expect(() => ConstraintsSchema.parse({ ...validConstraints, maxFilesChanged: 1.5 })).toThrow();
  });

  it("accepts empty arrays for the string-array fields", () => {
    const result = ConstraintsSchema.parse({
      ...validConstraints,
      requiredChecks: [],
      forbiddenPatterns: [],
      mustNotTouch: [],
    });
    expect(result.requiredChecks).toEqual([]);
  });

  it("rejects when requiredChecks is not an array", () => {
    expect(() => ConstraintsSchema.parse({ ...validConstraints, requiredChecks: "lint" })).toThrow();
  });
});

describe("RelatedIssueSchema", () => {
  it("parses a well-formed related issue", () => {
    expect(RelatedIssueSchema.parse(validRelatedIssue)).toEqual(validRelatedIssue);
  });

  it("accepts optional identifier and url", () => {
    const withOptional = { ...validRelatedIssue, identifier: "ENG-0", url: "https://example.com" };
    expect(RelatedIssueSchema.parse(withOptional)).toEqual(withOptional);
  });

  it("rejects an out-of-range priority", () => {
    expect(() => RelatedIssueSchema.parse({ ...validRelatedIssue, priority: 5 })).toThrow();
  });

  it("rejects when state is missing", () => {
    const { state, ...rest } = validRelatedIssue;
    expect(() => RelatedIssueSchema.parse(rest)).toThrow();
  });
});

describe("RelatedContextSchema", () => {
  it("parses with a parent and blockers", () => {
    const result = RelatedContextSchema.parse({
      parent: validRelatedIssue,
      blockers: [validRelatedIssue],
    });
    expect(result.parent).toEqual(validRelatedIssue);
    expect(result.blockers).toHaveLength(1);
  });

  it("parses with an empty blockers array and no parent", () => {
    const result = RelatedContextSchema.parse({ blockers: [] });
    expect(result.parent).toBeUndefined();
    expect(result.blockers).toEqual([]);
  });

  it("rejects when blockers is missing", () => {
    expect(() => RelatedContextSchema.parse({})).toThrow();
  });

  it("rejects a malformed parent", () => {
    expect(() =>
      RelatedContextSchema.parse({ parent: { id: "x" }, blockers: [] }),
    ).toThrow();
  });
});

describe("TaskBundleSchema", () => {
  const validBundle = {
    issue: validIssue,
    repo: validRepo,
    constraints: validConstraints,
    definitionOfDone: ["All tests pass", "Code reviewed"],
  };

  it("parses a well-formed bundle without relatedContext", () => {
    const result = TaskBundleSchema.parse(validBundle);
    expect(result).toEqual(validBundle);
    expect(result.relatedContext).toBeUndefined();
  });

  it("parses a well-formed bundle with relatedContext", () => {
    const withRelated = {
      ...validBundle,
      relatedContext: { parent: validRelatedIssue, blockers: [] },
    };
    const result = TaskBundleSchema.parse(withRelated);
    expect(result.relatedContext?.parent).toEqual(validRelatedIssue);
  });

  it("rejects when issue is malformed (nested validation propagates)", () => {
    expect(() =>
      TaskBundleSchema.parse({ ...validBundle, issue: { ...validIssue, priority: 10 } }),
    ).toThrow();
  });

  it("rejects when definitionOfDone is missing", () => {
    const { definitionOfDone, ...rest } = validBundle;
    expect(() => TaskBundleSchema.parse(rest)).toThrow();
  });

  it("rejects when constraints is missing entirely", () => {
    const { constraints, ...rest } = validBundle;
    expect(() => TaskBundleSchema.parse(rest)).toThrow();
  });

  it("rejects a completely empty object", () => {
    expect(() => TaskBundleSchema.parse({})).toThrow();
  });
});
