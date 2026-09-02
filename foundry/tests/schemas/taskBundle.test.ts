import { describe, it, expect } from "vitest";
import {
  IssueSchema,
  RepoConfigSchema,
  ConstraintsSchema,
  RelatedIssueSchema,
  RelatedContextSchema,
  TaskBundleSchema,
} from "../../src/schemas/taskBundle.js";

function makeValidIssue() {
  return {
    id: "LIN-1",
    title: "Fix bug",
    description: "A bug needs fixing",
    labels: ["bug"],
    priority: 2,
  };
}

function makeValidRepo() {
  return {
    name: "test-repo",
    defaultBranch: "main",
    workingBranch: "ai/lin-1",
    repoPath: "/tmp/repo",
    allowedPaths: ["src/"],
    protectedPaths: ["src/generated/"],
  };
}

function makeValidConstraints() {
  return {
    requiredChecks: ["lint", "test"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: ["console.log"],
    mustNotTouch: ["package.json"],
  };
}

function makeValidRelatedIssue() {
  return {
    id: "b1",
    identifier: "PRY-101",
    title: "Blocker",
    description: "Must complete first",
    state: "Todo",
    labels: ["infra"],
    priority: 1,
    url: "https://linear.app/issue/PRY-101",
  };
}

function makeValidTaskBundle() {
  return {
    issue: makeValidIssue(),
    repo: makeValidRepo(),
    constraints: makeValidConstraints(),
    definitionOfDone: ["Tests pass"],
  };
}

describe("IssueSchema", () => {
  it("parses a valid issue", () => {
    const result = IssueSchema.parse(makeValidIssue());
    expect(result.id).toBe("LIN-1");
    expect(result.priority).toBe(2);
  });

  it("accepts optional project and cycle fields", () => {
    const result = IssueSchema.parse({
      ...makeValidIssue(),
      project: "Foundry",
      cycle: "Cycle 4",
    });
    expect(result.project).toBe("Foundry");
    expect(result.cycle).toBe("Cycle 4");
  });

  it("omits optional fields when absent", () => {
    const result = IssueSchema.parse(makeValidIssue());
    expect(result.project).toBeUndefined();
    expect(result.cycle).toBeUndefined();
  });

  it("rejects a missing required field", () => {
    const { title: _title, ...rest } = makeValidIssue();
    expect(() => IssueSchema.parse(rest)).toThrow();
  });

  it("rejects a non-integer priority", () => {
    expect(() => IssueSchema.parse({ ...makeValidIssue(), priority: 1.5 })).toThrow();
  });

  it("rejects priority below the minimum boundary", () => {
    expect(() => IssueSchema.parse({ ...makeValidIssue(), priority: -1 })).toThrow();
  });

  it("rejects priority above the maximum boundary", () => {
    expect(() => IssueSchema.parse({ ...makeValidIssue(), priority: 5 })).toThrow();
  });

  it("accepts priority at the boundary values 0 and 4", () => {
    expect(IssueSchema.parse({ ...makeValidIssue(), priority: 0 }).priority).toBe(0);
    expect(IssueSchema.parse({ ...makeValidIssue(), priority: 4 }).priority).toBe(4);
  });

  it("rejects the wrong type for labels", () => {
    expect(() => IssueSchema.parse({ ...makeValidIssue(), labels: "bug" })).toThrow();
  });
});

describe("RepoConfigSchema", () => {
  it("parses a valid repo config", () => {
    const result = RepoConfigSchema.parse(makeValidRepo());
    expect(result.name).toBe("test-repo");
    expect(result.allowedPaths).toEqual(["src/"]);
  });

  it("rejects a missing required field", () => {
    const { repoPath: _repoPath, ...rest } = makeValidRepo();
    expect(() => RepoConfigSchema.parse(rest)).toThrow();
  });

  it("allows empty arrays for allowedPaths/protectedPaths", () => {
    const result = RepoConfigSchema.parse({
      ...makeValidRepo(),
      allowedPaths: [],
      protectedPaths: [],
    });
    expect(result.allowedPaths).toEqual([]);
    expect(result.protectedPaths).toEqual([]);
  });

  it("rejects a non-string name", () => {
    expect(() => RepoConfigSchema.parse({ ...makeValidRepo(), name: 123 })).toThrow();
  });
});

describe("ConstraintsSchema", () => {
  it("parses valid constraints", () => {
    const result = ConstraintsSchema.parse(makeValidConstraints());
    expect(result.maxFilesChanged).toBe(10);
  });

  it("rejects zero for maxFilesChanged (must be positive)", () => {
    expect(() => ConstraintsSchema.parse({ ...makeValidConstraints(), maxFilesChanged: 0 })).toThrow();
  });

  it("rejects a negative maxDiffLines", () => {
    expect(() => ConstraintsSchema.parse({ ...makeValidConstraints(), maxDiffLines: -1 })).toThrow();
  });

  it("rejects a non-integer maxFilesChanged", () => {
    expect(() =>
      ConstraintsSchema.parse({ ...makeValidConstraints(), maxFilesChanged: 1.5 }),
    ).toThrow();
  });

  it("accepts maxFilesChanged of 1 (boundary just above zero)", () => {
    expect(
      ConstraintsSchema.parse({ ...makeValidConstraints(), maxFilesChanged: 1 }).maxFilesChanged,
    ).toBe(1);
  });
});

describe("RelatedIssueSchema", () => {
  it("parses a valid related issue with optional fields", () => {
    const result = RelatedIssueSchema.parse(makeValidRelatedIssue());
    expect(result.identifier).toBe("PRY-101");
    expect(result.url).toBe("https://linear.app/issue/PRY-101");
  });

  it("parses without optional identifier/url", () => {
    const { identifier: _identifier, url: _url, ...rest } = makeValidRelatedIssue();
    const result = RelatedIssueSchema.parse(rest);
    expect(result.identifier).toBeUndefined();
    expect(result.url).toBeUndefined();
  });

  it("rejects priority out of range", () => {
    expect(() => RelatedIssueSchema.parse({ ...makeValidRelatedIssue(), priority: 10 })).toThrow();
  });

  it("rejects a missing required state field", () => {
    const { state: _state, ...rest } = makeValidRelatedIssue();
    expect(() => RelatedIssueSchema.parse(rest)).toThrow();
  });
});

describe("RelatedContextSchema", () => {
  it("parses with a parent and blockers", () => {
    const result = RelatedContextSchema.parse({
      parent: makeValidRelatedIssue(),
      blockers: [makeValidRelatedIssue()],
    });
    expect(result.parent?.id).toBe("b1");
    expect(result.blockers).toHaveLength(1);
  });

  it("parses with no parent (optional) and empty blockers", () => {
    const result = RelatedContextSchema.parse({ blockers: [] });
    expect(result.parent).toBeUndefined();
    expect(result.blockers).toEqual([]);
  });

  it("rejects when blockers is missing (required array)", () => {
    expect(() => RelatedContextSchema.parse({})).toThrow();
  });

  it("rejects an invalid related issue inside blockers", () => {
    expect(() =>
      RelatedContextSchema.parse({ blockers: [{ ...makeValidRelatedIssue(), priority: -5 }] }),
    ).toThrow();
  });
});

describe("TaskBundleSchema", () => {
  it("parses a valid minimal task bundle without relatedContext", () => {
    const result = TaskBundleSchema.parse(makeValidTaskBundle());
    expect(result.issue.id).toBe("LIN-1");
    expect(result.relatedContext).toBeUndefined();
  });

  it("parses a full task bundle including relatedContext", () => {
    const bundle = {
      ...makeValidTaskBundle(),
      relatedContext: {
        parent: makeValidRelatedIssue(),
        blockers: [makeValidRelatedIssue()],
      },
    };
    const result = TaskBundleSchema.parse(bundle);
    expect(result.relatedContext?.blockers).toHaveLength(1);
  });

  it("rejects when a nested required field is missing (repo.name)", () => {
    const bundle = makeValidTaskBundle();
    const { name: _name, ...repoRest } = bundle.repo;
    expect(() => TaskBundleSchema.parse({ ...bundle, repo: repoRest })).toThrow();
  });

  it("rejects when definitionOfDone is not an array", () => {
    expect(() =>
      TaskBundleSchema.parse({ ...makeValidTaskBundle(), definitionOfDone: "done" }),
    ).toThrow();
  });

  it("rejects a completely empty object", () => {
    const result = TaskBundleSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toEqual(expect.arrayContaining(["issue", "repo", "constraints", "definitionOfDone"]));
    }
  });

  it("rejects an invalid nested issue priority within a full bundle", () => {
    const bundle = makeValidTaskBundle();
    const result = TaskBundleSchema.safeParse({
      ...bundle,
      issue: { ...bundle.issue, priority: 99 },
    });
    expect(result.success).toBe(false);
  });
});
