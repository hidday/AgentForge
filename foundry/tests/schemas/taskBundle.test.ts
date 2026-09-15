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
  id: "LIN-1",
  title: "Fix bug",
  description: "Something is broken",
  labels: ["bug"],
  priority: 2,
};

const validRepo = {
  name: "acme/repo",
  defaultBranch: "main",
  workingBranch: "feature/x",
  repoPath: "./workspace",
  allowedPaths: ["src/"],
  protectedPaths: [".github/"],
};

const validConstraints = {
  requiredChecks: ["lint"],
  maxFilesChanged: 10,
  maxDiffLines: 500,
  forbiddenPatterns: ["eval("],
  mustNotTouch: ["prisma/migrations/"],
};

const validRelatedIssue = {
  id: "LIN-2",
  title: "Parent issue",
  description: "Parent description",
  state: "Todo",
  labels: [],
  priority: 1,
};

describe("IssueSchema", () => {
  it("accepts a fully populated issue", () => {
    const result = IssueSchema.parse({
      ...validIssue,
      project: "Backend",
      cycle: "Sprint 1",
    });
    expect(result.project).toBe("Backend");
    expect(result.cycle).toBe("Sprint 1");
  });

  it("accepts an issue without the optional project/cycle fields", () => {
    const result = IssueSchema.parse(validIssue);
    expect(result.project).toBeUndefined();
    expect(result.cycle).toBeUndefined();
  });

  it("rejects priority below the minimum boundary", () => {
    expect(() => IssueSchema.parse({ ...validIssue, priority: -1 })).toThrow();
  });

  it("rejects priority above the maximum boundary", () => {
    expect(() => IssueSchema.parse({ ...validIssue, priority: 5 })).toThrow();
  });

  it("accepts priority at the min (0) and max (4) boundaries", () => {
    expect(IssueSchema.parse({ ...validIssue, priority: 0 }).priority).toBe(0);
    expect(IssueSchema.parse({ ...validIssue, priority: 4 }).priority).toBe(4);
  });

  it("rejects a non-integer priority", () => {
    expect(() => IssueSchema.parse({ ...validIssue, priority: 1.5 })).toThrow();
  });

  it("rejects a missing required field", () => {
    const { title: _title, ...withoutTitle } = validIssue;
    expect(() => IssueSchema.parse(withoutTitle)).toThrow();
  });

  it("rejects labels that are not an array of strings", () => {
    expect(() => IssueSchema.parse({ ...validIssue, labels: [1, 2] })).toThrow();
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a valid repo config", () => {
    expect(RepoConfigSchema.parse(validRepo)).toEqual(validRepo);
  });

  it("rejects a missing required field", () => {
    const { repoPath: _repoPath, ...rest } = validRepo;
    expect(() => RepoConfigSchema.parse(rest)).toThrow();
  });

  it("rejects non-string entries in allowedPaths", () => {
    expect(() => RepoConfigSchema.parse({ ...validRepo, allowedPaths: [1] })).toThrow();
  });
});

describe("ConstraintsSchema", () => {
  it("accepts valid constraints", () => {
    expect(ConstraintsSchema.parse(validConstraints)).toEqual(validConstraints);
  });

  it("rejects maxFilesChanged that is zero (not positive)", () => {
    expect(() =>
      ConstraintsSchema.parse({ ...validConstraints, maxFilesChanged: 0 }),
    ).toThrow();
  });

  it("rejects a negative maxDiffLines", () => {
    expect(() =>
      ConstraintsSchema.parse({ ...validConstraints, maxDiffLines: -5 }),
    ).toThrow();
  });

  it("rejects a non-integer maxFilesChanged", () => {
    expect(() =>
      ConstraintsSchema.parse({ ...validConstraints, maxFilesChanged: 1.5 }),
    ).toThrow();
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a related issue with optional identifier and url", () => {
    const result = RelatedIssueSchema.parse({
      ...validRelatedIssue,
      identifier: "LIN-2",
      url: "https://example.com",
    });
    expect(result.identifier).toBe("LIN-2");
  });

  it("accepts a related issue without identifier/url", () => {
    const result = RelatedIssueSchema.parse(validRelatedIssue);
    expect(result.identifier).toBeUndefined();
    expect(result.url).toBeUndefined();
  });

  it("rejects priority outside 0-4", () => {
    expect(() => RelatedIssueSchema.parse({ ...validRelatedIssue, priority: 7 })).toThrow();
  });
});

describe("RelatedContextSchema", () => {
  it("accepts a context with a parent and blockers", () => {
    const result = RelatedContextSchema.parse({
      parent: validRelatedIssue,
      blockers: [validRelatedIssue],
    });
    expect(result.blockers).toHaveLength(1);
  });

  it("accepts a context with no parent and empty blockers", () => {
    const result = RelatedContextSchema.parse({ blockers: [] });
    expect(result.parent).toBeUndefined();
    expect(result.blockers).toEqual([]);
  });

  it("rejects a context missing the required blockers array", () => {
    expect(() => RelatedContextSchema.parse({})).toThrow();
  });
});

describe("TaskBundleSchema", () => {
  const validBundle = {
    issue: validIssue,
    repo: validRepo,
    constraints: validConstraints,
    definitionOfDone: ["All tests pass"],
  };

  it("accepts a minimal valid bundle without relatedContext", () => {
    const result = TaskBundleSchema.parse(validBundle);
    expect(result.relatedContext).toBeUndefined();
  });

  it("accepts a full bundle including relatedContext", () => {
    const result = TaskBundleSchema.parse({
      ...validBundle,
      relatedContext: { parent: validRelatedIssue, blockers: [] },
    });
    expect(result.relatedContext?.parent?.id).toBe(validRelatedIssue.id);
  });

  it("rejects a bundle with an invalid nested issue", () => {
    expect(() =>
      TaskBundleSchema.parse({ ...validBundle, issue: { ...validIssue, priority: 99 } }),
    ).toThrow();
  });

  it("rejects a bundle missing definitionOfDone", () => {
    const { definitionOfDone: _dod, ...rest } = validBundle;
    expect(() => TaskBundleSchema.parse(rest)).toThrow();
  });

  it("rejects a bundle with a malformed relatedContext", () => {
    expect(() =>
      TaskBundleSchema.parse({ ...validBundle, relatedContext: { parent: {} } }),
    ).toThrow();
  });
});
