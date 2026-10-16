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
    id: "issue-1",
    title: "Fix the bug",
    description: "A bug needs fixing",
    labels: ["bug"],
    priority: 2,
  };
}

function validRepo() {
  return {
    name: "test-repo",
    defaultBranch: "main",
    workingBranch: "feature/foo",
    repoPath: "/repo",
    allowedPaths: ["src/"],
    protectedPaths: [".github/"],
  };
}

function validConstraints() {
  return {
    requiredChecks: ["lint", "test"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: ["eval("],
    mustNotTouch: ["secrets/"],
  };
}

function validRelatedIssue() {
  return {
    id: "related-1",
    title: "Parent issue",
    description: "parent desc",
    state: "open",
    labels: [],
    priority: 1,
  };
}

function validBundle() {
  return {
    issue: validIssue(),
    repo: validRepo(),
    constraints: validConstraints(),
    definitionOfDone: ["All tests pass"],
  };
}

describe("IssueSchema", () => {
  it("parses a valid issue", () => {
    const result = IssueSchema.parse(validIssue());
    expect(result).toEqual(validIssue());
  });

  it("allows optional project and cycle to be omitted", () => {
    const result = IssueSchema.parse(validIssue());
    expect(result.project).toBeUndefined();
    expect(result.cycle).toBeUndefined();
  });

  it("parses when optional project and cycle are provided", () => {
    const input = { ...validIssue(), project: "proj-1", cycle: "cycle-1" };
    const result = IssueSchema.parse(input);
    expect(result.project).toBe("proj-1");
    expect(result.cycle).toBe("cycle-1");
  });

  it("rejects a missing required field (title)", () => {
    const { title, ...rest } = validIssue();
    const result = IssueSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("title"))).toBe(true);
    }
  });

  it("rejects wrong type for labels (string instead of array)", () => {
    const input = { ...validIssue(), labels: "bug" };
    const result = IssueSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("labels"))).toBe(true);
    }
  });

  it("rejects priority below the minimum boundary (-1)", () => {
    const input = { ...validIssue(), priority: -1 };
    const result = IssueSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects priority above the maximum boundary (5)", () => {
    const input = { ...validIssue(), priority: 5 };
    const result = IssueSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("accepts priority at the minimum boundary (0)", () => {
    const input = { ...validIssue(), priority: 0 };
    const result = IssueSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("accepts priority at the maximum boundary (4)", () => {
    const input = { ...validIssue(), priority: 4 };
    const result = IssueSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects a non-integer priority", () => {
    const input = { ...validIssue(), priority: 2.5 };
    const result = IssueSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("parses a valid repo config", () => {
    const result = RepoConfigSchema.parse(validRepo());
    expect(result).toEqual(validRepo());
  });

  it("rejects a missing required field (repoPath)", () => {
    const { repoPath, ...rest } = validRepo();
    const result = RepoConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects wrong type for allowedPaths (number instead of array)", () => {
    const input = { ...validRepo(), allowedPaths: 123 };
    const result = RepoConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("parses valid constraints", () => {
    const result = ConstraintsSchema.parse(validConstraints());
    expect(result).toEqual(validConstraints());
  });

  it("rejects a missing required field (maxFilesChanged)", () => {
    const { maxFilesChanged, ...rest } = validConstraints();
    const result = ConstraintsSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects maxFilesChanged of zero (must be positive)", () => {
    const input = { ...validConstraints(), maxFilesChanged: 0 };
    const result = ConstraintsSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects a negative maxFilesChanged", () => {
    const input = { ...validConstraints(), maxFilesChanged: -5 };
    const result = ConstraintsSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("accepts maxFilesChanged at the boundary of 1", () => {
    const input = { ...validConstraints(), maxFilesChanged: 1 };
    const result = ConstraintsSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects a non-integer maxFilesChanged", () => {
    const input = { ...validConstraints(), maxFilesChanged: 1.5 };
    const result = ConstraintsSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects maxDiffLines of zero (must be positive)", () => {
    const input = { ...validConstraints(), maxDiffLines: 0 };
    const result = ConstraintsSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("accepts maxDiffLines at the boundary of 1", () => {
    const input = { ...validConstraints(), maxDiffLines: 1 };
    const result = ConstraintsSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects wrong type for forbiddenPatterns (array of numbers instead of strings)", () => {
    const input = { ...validConstraints(), forbiddenPatterns: [1, 2, 3] };
    const result = ConstraintsSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("accepts empty arrays for forbiddenPatterns and mustNotTouch", () => {
    const input = { ...validConstraints(), forbiddenPatterns: [], mustNotTouch: [] };
    const result = ConstraintsSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

describe("RelatedIssueSchema / RelatedContextSchema", () => {
  it("parses a valid related issue without optional fields", () => {
    const result = RelatedIssueSchema.parse(validRelatedIssue());
    expect(result.identifier).toBeUndefined();
    expect(result.url).toBeUndefined();
  });

  it("parses a valid related issue with optional fields provided", () => {
    const input = { ...validRelatedIssue(), identifier: "ENG-1", url: "https://example.com" };
    const result = RelatedIssueSchema.parse(input);
    expect(result.identifier).toBe("ENG-1");
    expect(result.url).toBe("https://example.com");
  });

  it("rejects a related issue missing a required field (state)", () => {
    const { state, ...rest } = validRelatedIssue();
    const result = RelatedIssueSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("parses a related context with no parent and empty blockers", () => {
    const result = RelatedContextSchema.parse({ blockers: [] });
    expect(result.parent).toBeUndefined();
    expect(result.blockers).toEqual([]);
  });

  it("parses a related context with a parent and blockers", () => {
    const input = {
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue(), { ...validRelatedIssue(), id: "related-2" }],
    };
    const result = RelatedContextSchema.parse(input);
    expect(result.parent?.id).toBe("related-1");
    expect(result.blockers).toHaveLength(2);
  });

  it("rejects a related context missing required blockers array", () => {
    const result = RelatedContextSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  it("parses a complete valid bundle without relatedContext", () => {
    const result = TaskBundleSchema.parse(validBundle());
    expect(result.issue.id).toBe("issue-1");
    expect(result.relatedContext).toBeUndefined();
  });

  it("parses a complete valid bundle including relatedContext", () => {
    const input = {
      ...validBundle(),
      relatedContext: { parent: validRelatedIssue(), blockers: [] },
    };
    const result = TaskBundleSchema.parse(input);
    expect(result.relatedContext?.parent?.id).toBe("related-1");
  });

  it("rejects a bundle missing the required issue field", () => {
    const { issue, ...rest } = validBundle();
    const result = TaskBundleSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "issue")).toBe(true);
    }
  });

  it("rejects a bundle missing the required repo field", () => {
    const { repo, ...rest } = validBundle();
    const result = TaskBundleSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects a bundle missing the required constraints field", () => {
    const { constraints, ...rest } = validBundle();
    const result = TaskBundleSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects a bundle missing the required definitionOfDone field", () => {
    const { definitionOfDone, ...rest } = validBundle();
    const result = TaskBundleSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects a bundle where a nested field has the wrong type (issue.priority as string)", () => {
    const input = { ...validBundle(), issue: { ...validIssue(), priority: "high" } };
    const result = TaskBundleSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "issue.priority")).toBe(true);
    }
  });

  it("rejects a completely empty object", () => {
    const result = TaskBundleSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("throws (not just returns false) via .parse on invalid input", () => {
    expect(() => TaskBundleSchema.parse({})).toThrow();
  });
});
