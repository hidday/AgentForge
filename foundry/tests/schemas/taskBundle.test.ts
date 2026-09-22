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
    title: "Do the thing",
    description: "Description of the thing",
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

function validRelatedIssue() {
  return {
    id: "p1",
    identifier: "PRY-100",
    title: "Parent",
    description: "Parent description",
    state: "In Progress",
    labels: ["epic"],
    priority: 1,
    url: "https://linear.app/team/issue/PRY-100",
  };
}

describe("IssueSchema", () => {
  it("parses a valid issue", () => {
    const result = IssueSchema.parse(validIssue());
    expect(result.id).toBe("LIN-1");
    expect(result.priority).toBe(2);
  });

  it("accepts optional project and cycle fields", () => {
    const result = IssueSchema.parse({ ...validIssue(), project: "Proj", cycle: "Cycle 1" });
    expect(result.project).toBe("Proj");
    expect(result.cycle).toBe("Cycle 1");
  });

  it("rejects priority below the minimum (0)", () => {
    expect(() => IssueSchema.parse({ ...validIssue(), priority: -1 })).toThrow();
  });

  it("rejects priority above the maximum (4)", () => {
    expect(() => IssueSchema.parse({ ...validIssue(), priority: 5 })).toThrow();
  });

  it("rejects a non-integer priority", () => {
    expect(() => IssueSchema.parse({ ...validIssue(), priority: 1.5 })).toThrow();
  });

  it("rejects a missing required field", () => {
    const { title: _title, ...rest } = validIssue();
    expect(() => IssueSchema.parse(rest)).toThrow();
  });
});

describe("RepoConfigSchema", () => {
  it("parses a valid repo config", () => {
    const result = RepoConfigSchema.parse(validRepo());
    expect(result.name).toBe("test-repo");
  });

  it("rejects a missing repoPath", () => {
    const { repoPath: _repoPath, ...rest } = validRepo();
    expect(() => RepoConfigSchema.parse(rest)).toThrow();
  });

  it("rejects a non-array allowedPaths", () => {
    expect(() => RepoConfigSchema.parse({ ...validRepo(), allowedPaths: "src/" })).toThrow();
  });
});

describe("ConstraintsSchema", () => {
  it("parses valid constraints", () => {
    const result = ConstraintsSchema.parse(validConstraints());
    expect(result.maxFilesChanged).toBe(10);
  });

  it("rejects a zero or negative maxFilesChanged", () => {
    expect(() => ConstraintsSchema.parse({ ...validConstraints(), maxFilesChanged: 0 })).toThrow();
    expect(() =>
      ConstraintsSchema.parse({ ...validConstraints(), maxFilesChanged: -5 }),
    ).toThrow();
  });

  it("rejects a zero or negative maxDiffLines", () => {
    expect(() => ConstraintsSchema.parse({ ...validConstraints(), maxDiffLines: 0 })).toThrow();
  });

  it("rejects a non-integer maxFilesChanged", () => {
    expect(() =>
      ConstraintsSchema.parse({ ...validConstraints(), maxFilesChanged: 3.5 }),
    ).toThrow();
  });
});

describe("RelatedIssueSchema", () => {
  it("parses a valid related issue with optional fields present", () => {
    const result = RelatedIssueSchema.parse(validRelatedIssue());
    expect(result.identifier).toBe("PRY-100");
    expect(result.url).toBe("https://linear.app/team/issue/PRY-100");
  });

  it("parses without the optional identifier and url fields", () => {
    const { identifier: _identifier, url: _url, ...rest } = validRelatedIssue();
    const result = RelatedIssueSchema.parse(rest);
    expect(result.identifier).toBeUndefined();
    expect(result.url).toBeUndefined();
  });

  it("rejects priority out of range", () => {
    expect(() => RelatedIssueSchema.parse({ ...validRelatedIssue(), priority: 9 })).toThrow();
  });
});

describe("RelatedContextSchema", () => {
  it("parses with a parent and blockers", () => {
    const result = RelatedContextSchema.parse({
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue()],
    });
    expect(result.blockers).toHaveLength(1);
    expect(result.parent?.id).toBe("p1");
  });

  it("parses with an empty blockers array and no parent", () => {
    const result = RelatedContextSchema.parse({ blockers: [] });
    expect(result.parent).toBeUndefined();
    expect(result.blockers).toEqual([]);
  });

  it("rejects a missing blockers field", () => {
    expect(() => RelatedContextSchema.parse({})).toThrow();
  });
});

describe("TaskBundleSchema", () => {
  function validBundle() {
    return {
      issue: validIssue(),
      repo: validRepo(),
      constraints: validConstraints(),
      definitionOfDone: ["Tests pass"],
    };
  }

  it("parses a minimal valid bundle without relatedContext", () => {
    const result = TaskBundleSchema.parse(validBundle());
    expect(result.relatedContext).toBeUndefined();
    expect(result.definitionOfDone).toEqual(["Tests pass"]);
  });

  it("parses a full bundle including relatedContext", () => {
    const result = TaskBundleSchema.parse({
      ...validBundle(),
      relatedContext: { parent: validRelatedIssue(), blockers: [] },
    });
    expect(result.relatedContext?.parent?.title).toBe("Parent");
  });

  it("rejects a bundle missing the issue field", () => {
    const { issue: _issue, ...rest } = validBundle();
    expect(() => TaskBundleSchema.parse(rest)).toThrow();
  });

  it("rejects a bundle with an invalid nested issue", () => {
    const bundle = validBundle();
    expect(() =>
      TaskBundleSchema.parse({ ...bundle, issue: { ...bundle.issue, priority: 99 } }),
    ).toThrow();
  });

  it("rejects a bundle with a non-array definitionOfDone", () => {
    expect(() =>
      TaskBundleSchema.parse({ ...validBundle(), definitionOfDone: "not an array" }),
    ).toThrow();
  });
});
