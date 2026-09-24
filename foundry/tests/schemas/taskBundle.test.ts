import { describe, it, expect } from "vitest";
import {
  IssueSchema,
  RepoConfigSchema,
  ConstraintsSchema,
  RelatedIssueSchema,
  RelatedContextSchema,
  TaskBundleSchema,
} from "../../src/schemas/taskBundle.js";

function makeIssue(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "LIN-1",
    title: "Fix the thing",
    description: "Details about the thing",
    labels: ["bug"],
    priority: 2,
    ...overrides,
  };
}

function makeRepoConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: "acme/repo",
    defaultBranch: "main",
    workingBranch: "agent/lin-1",
    repoPath: "./workspace",
    allowedPaths: ["src/"],
    protectedPaths: [".github/"],
    ...overrides,
  };
}

function makeConstraints(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    requiredChecks: ["lint"],
    maxFilesChanged: 5,
    maxDiffLines: 300,
    forbiddenPatterns: [],
    mustNotTouch: [],
    ...overrides,
  };
}

function makeRelatedIssue(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "LIN-0",
    title: "Parent issue",
    description: "Parent description",
    state: "In Progress",
    labels: [],
    priority: 1,
    ...overrides,
  };
}

function makeBundle(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    issue: makeIssue(),
    repo: makeRepoConfig(),
    constraints: makeConstraints(),
    definitionOfDone: ["All tests pass"],
    ...overrides,
  };
}

describe("IssueSchema", () => {
  it("parses a valid issue", () => {
    const result = IssueSchema.parse(makeIssue());
    expect(result.id).toBe("LIN-1");
    expect(result.project).toBeUndefined();
  });

  it("accepts priority boundaries 0 and 4", () => {
    expect(() => IssueSchema.parse(makeIssue({ priority: 0 }))).not.toThrow();
    expect(() => IssueSchema.parse(makeIssue({ priority: 4 }))).not.toThrow();
  });

  it("rejects priority below 0", () => {
    expect(() => IssueSchema.parse(makeIssue({ priority: -1 }))).toThrow();
  });

  it("rejects priority above 4", () => {
    expect(() => IssueSchema.parse(makeIssue({ priority: 5 }))).toThrow();
  });

  it("rejects a non-integer priority", () => {
    expect(() => IssueSchema.parse(makeIssue({ priority: 1.5 }))).toThrow();
  });

  it("rejects a missing required field", () => {
    const { title: _title, ...rest } = makeIssue();
    expect(() => IssueSchema.parse(rest)).toThrow();
  });
});

describe("RepoConfigSchema", () => {
  it("parses a valid repo config", () => {
    expect(() => RepoConfigSchema.parse(makeRepoConfig())).not.toThrow();
  });

  it("rejects a missing required field", () => {
    const { repoPath: _repoPath, ...rest } = makeRepoConfig();
    expect(() => RepoConfigSchema.parse(rest)).toThrow();
  });
});

describe("ConstraintsSchema", () => {
  it("parses valid constraints", () => {
    expect(() => ConstraintsSchema.parse(makeConstraints())).not.toThrow();
  });

  it("rejects a non-positive maxFilesChanged", () => {
    expect(() => ConstraintsSchema.parse(makeConstraints({ maxFilesChanged: 0 }))).toThrow();
  });

  it("rejects a non-positive maxDiffLines", () => {
    expect(() => ConstraintsSchema.parse(makeConstraints({ maxDiffLines: -5 }))).toThrow();
  });
});

describe("RelatedIssueSchema / RelatedContextSchema", () => {
  it("parses a valid related issue with optional fields omitted", () => {
    const result = RelatedIssueSchema.parse(makeRelatedIssue());
    expect(result.identifier).toBeUndefined();
    expect(result.url).toBeUndefined();
  });

  it("parses a valid related issue with optional fields present", () => {
    const result = RelatedIssueSchema.parse(
      makeRelatedIssue({ identifier: "LIN-0", url: "https://linear.app/x" }),
    );
    expect(result.identifier).toBe("LIN-0");
  });

  it("parses related context with a parent and blockers", () => {
    const result = RelatedContextSchema.parse({
      parent: makeRelatedIssue(),
      blockers: [makeRelatedIssue({ id: "LIN-2" })],
    });
    expect(result.blockers).toHaveLength(1);
  });

  it("parses related context with no parent", () => {
    const result = RelatedContextSchema.parse({ blockers: [] });
    expect(result.parent).toBeUndefined();
  });

  it("rejects related context missing blockers", () => {
    expect(() => RelatedContextSchema.parse({})).toThrow();
  });
});

describe("TaskBundleSchema", () => {
  it("parses a minimal valid bundle without relatedContext", () => {
    const result = TaskBundleSchema.parse(makeBundle());
    expect(result.relatedContext).toBeUndefined();
    expect(result.issue.id).toBe("LIN-1");
  });

  it("parses a full valid bundle with relatedContext", () => {
    const bundle = makeBundle({
      relatedContext: { parent: makeRelatedIssue(), blockers: [] },
    });
    const result = TaskBundleSchema.parse(bundle);
    expect(result.relatedContext?.parent?.id).toBe("LIN-0");
  });

  it("rejects a bundle with an invalid nested issue", () => {
    const bundle = makeBundle({ issue: makeIssue({ priority: 10 }) });
    expect(() => TaskBundleSchema.parse(bundle)).toThrow();
  });

  it("rejects a bundle missing definitionOfDone", () => {
    const { definitionOfDone: _dod, ...rest } = makeBundle();
    expect(() => TaskBundleSchema.parse(rest)).toThrow();
  });

  it("rejects a bundle with an invalid nested constraints object", () => {
    const bundle = makeBundle({ constraints: makeConstraints({ maxFilesChanged: -1 }) });
    expect(() => TaskBundleSchema.parse(bundle)).toThrow();
  });
});
