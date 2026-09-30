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
    name: "acme/repo",
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
    id: "LIN-2",
    title: "Related",
    description: "Related description",
    state: "Todo",
    labels: [],
    priority: 1,
  };
}

describe("IssueSchema", () => {
  it("parses a valid issue including optional project/cycle", () => {
    const result = IssueSchema.parse({ ...validIssue(), project: "P1", cycle: "C1" });
    expect(result.project).toBe("P1");
    expect(result.cycle).toBe("C1");
  });

  it("parses a valid issue without optional fields", () => {
    const result = IssueSchema.parse(validIssue());
    expect(result.project).toBeUndefined();
    expect(result.cycle).toBeUndefined();
  });

  it("rejects a priority above the max bound", () => {
    expect(() => IssueSchema.parse({ ...validIssue(), priority: 5 })).toThrow();
  });

  it("rejects a priority below the min bound", () => {
    expect(() => IssueSchema.parse({ ...validIssue(), priority: -1 })).toThrow();
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
    expect(RepoConfigSchema.parse(validRepo())).toEqual(validRepo());
  });

  it("rejects a config missing allowedPaths", () => {
    const { allowedPaths: _allowedPaths, ...rest } = validRepo();
    expect(() => RepoConfigSchema.parse(rest)).toThrow();
  });

  it("rejects wrong types for array fields", () => {
    expect(() => RepoConfigSchema.parse({ ...validRepo(), allowedPaths: "not-an-array" })).toThrow();
  });
});

describe("ConstraintsSchema", () => {
  it("parses valid constraints", () => {
    expect(ConstraintsSchema.parse(validConstraints())).toEqual(validConstraints());
  });

  it("rejects a non-positive maxFilesChanged", () => {
    expect(() => ConstraintsSchema.parse({ ...validConstraints(), maxFilesChanged: 0 })).toThrow();
  });

  it("rejects a negative maxDiffLines", () => {
    expect(() => ConstraintsSchema.parse({ ...validConstraints(), maxDiffLines: -5 })).toThrow();
  });

  it("rejects a non-integer maxFilesChanged", () => {
    expect(() => ConstraintsSchema.parse({ ...validConstraints(), maxFilesChanged: 1.2 })).toThrow();
  });
});

describe("RelatedIssueSchema", () => {
  it("parses a valid related issue including optional identifier/url", () => {
    const result = RelatedIssueSchema.parse({
      ...validRelatedIssue(),
      identifier: "LIN-2",
      url: "https://example.com/LIN-2",
    });
    expect(result.identifier).toBe("LIN-2");
    expect(result.url).toBe("https://example.com/LIN-2");
  });

  it("parses a valid related issue without optional fields", () => {
    const result = RelatedIssueSchema.parse(validRelatedIssue());
    expect(result.identifier).toBeUndefined();
    expect(result.url).toBeUndefined();
  });

  it("rejects an out-of-range priority", () => {
    expect(() => RelatedIssueSchema.parse({ ...validRelatedIssue(), priority: 10 })).toThrow();
  });

  it("rejects a missing required state field", () => {
    const { state: _state, ...rest } = validRelatedIssue();
    expect(() => RelatedIssueSchema.parse(rest)).toThrow();
  });
});

describe("RelatedContextSchema", () => {
  it("parses with a parent and blockers", () => {
    const result = RelatedContextSchema.parse({
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue()],
    });
    expect(result.parent?.id).toBe("LIN-2");
    expect(result.blockers).toHaveLength(1);
  });

  it("parses with no parent and empty blockers", () => {
    const result = RelatedContextSchema.parse({ blockers: [] });
    expect(result.parent).toBeUndefined();
    expect(result.blockers).toEqual([]);
  });

  it("rejects when blockers is missing", () => {
    expect(() => RelatedContextSchema.parse({})).toThrow();
  });

  it("rejects an invalid blocker entry", () => {
    expect(() =>
      RelatedContextSchema.parse({ blockers: [{ id: "x" }] }),
    ).toThrow();
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

  it("parses a valid bundle without relatedContext", () => {
    const result = TaskBundleSchema.parse(validBundle());
    expect(result.relatedContext).toBeUndefined();
    expect(result.definitionOfDone).toEqual(["All tests pass"]);
  });

  it("parses a valid bundle with relatedContext", () => {
    const result = TaskBundleSchema.parse({
      ...validBundle(),
      relatedContext: { blockers: [validRelatedIssue()] },
    });
    expect(result.relatedContext?.blockers).toHaveLength(1);
  });

  it("rejects a bundle missing the issue field", () => {
    const { issue: _issue, ...rest } = validBundle();
    expect(() => TaskBundleSchema.parse(rest)).toThrow();
  });

  it("rejects a bundle with an invalid nested repo config", () => {
    expect(() =>
      TaskBundleSchema.parse({ ...validBundle(), repo: { name: "only-name" } }),
    ).toThrow();
  });

  it("rejects a bundle where definitionOfDone is not an array", () => {
    expect(() =>
      TaskBundleSchema.parse({ ...validBundle(), definitionOfDone: "not an array" }),
    ).toThrow();
  });
});
