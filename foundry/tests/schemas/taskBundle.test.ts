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
    title: "Fix bug",
    description: "Something is broken",
    labels: ["bug"],
    priority: 2,
  };
}

function validRepo() {
  return {
    name: "acme/repo",
    defaultBranch: "main",
    workingBranch: "ai/lin-1",
    repoPath: "/workspace/repo",
    allowedPaths: ["src/"],
    protectedPaths: [".github/"],
  };
}

function validConstraints() {
  return {
    requiredChecks: ["lint", "tests"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: ["console\\.log"],
    mustNotTouch: ["prisma/migrations/"],
  };
}

function validRelatedIssue() {
  return {
    id: "LIN-2",
    identifier: "ENG-2",
    title: "Parent issue",
    description: "Parent description",
    state: "In Progress",
    labels: ["epic"],
    priority: 1,
    url: "https://linear.app/team/issue/ENG-2",
  };
}

function validTaskBundle() {
  return {
    issue: validIssue(),
    repo: validRepo(),
    constraints: validConstraints(),
    definitionOfDone: ["All tests pass"],
  };
}

describe("IssueSchema", () => {
  it("parses a valid issue", () => {
    const result = IssueSchema.safeParse(validIssue());
    expect(result.success).toBe(true);
  });

  it("allows project and cycle to be omitted (optional)", () => {
    const result = IssueSchema.safeParse(validIssue());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project).toBeUndefined();
      expect(result.data.cycle).toBeUndefined();
    }
  });

  it("accepts project and cycle when provided", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), project: "Platform", cycle: "S23" });
    expect(result.success).toBe(true);
  });

  it("rejects a missing required field (title)", () => {
    const { title, ...rest } = validIssue();
    const result = IssueSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects a wrong type for labels (string instead of array)", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), labels: "bug" });
    expect(result.success).toBe(false);
  });

  it("rejects priority below the minimum (0)", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects priority above the maximum (4)", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 5 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer priority", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 2.5 });
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("parses a valid repo config", () => {
    const result = RepoConfigSchema.safeParse(validRepo());
    expect(result.success).toBe(true);
  });

  it("rejects a missing required field (repoPath)", () => {
    const { repoPath, ...rest } = validRepo();
    const result = RepoConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects wrong type for allowedPaths", () => {
    const result = RepoConfigSchema.safeParse({ ...validRepo(), allowedPaths: "src/" });
    expect(result.success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("parses valid constraints", () => {
    const result = ConstraintsSchema.safeParse(validConstraints());
    expect(result.success).toBe(true);
  });

  it("rejects maxFilesChanged <= 0", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects maxDiffLines <= 0", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxDiffLines: -5 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-array forbiddenPatterns", () => {
    const result = ConstraintsSchema.safeParse({
      ...validConstraints(),
      forbiddenPatterns: "console.log",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field (mustNotTouch)", () => {
    const { mustNotTouch, ...rest } = validConstraints();
    const result = ConstraintsSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("parses a valid related issue with optional fields present", () => {
    const result = RelatedIssueSchema.safeParse(validRelatedIssue());
    expect(result.success).toBe(true);
  });

  it("parses a valid related issue without optional identifier/url", () => {
    const { identifier, url, ...rest } = validRelatedIssue();
    const result = RelatedIssueSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it("rejects a missing required field (state)", () => {
    const { state, ...rest } = validRelatedIssue();
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
    const result = RelatedContextSchema.safeParse({
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue()],
    });
    expect(result.success).toBe(true);
  });

  it("parses with no parent and an empty blockers array", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("rejects when blockers is missing (required)", () => {
    const result = RelatedContextSchema.safeParse({ parent: validRelatedIssue() });
    expect(result.success).toBe(false);
  });

  it("rejects when a blocker entry is invalid", () => {
    const { title, ...invalidBlocker } = validRelatedIssue();
    const result = RelatedContextSchema.safeParse({ blockers: [invalidBlocker] });
    expect(result.success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  it("parses a minimal valid task bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse(validTaskBundle());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relatedContext).toBeUndefined();
    }
  });

  it("parses a full task bundle including relatedContext", () => {
    const bundle = {
      ...validTaskBundle(),
      relatedContext: {
        parent: validRelatedIssue(),
        blockers: [validRelatedIssue()],
      },
    };
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
  });

  it("rejects a missing top-level required field (issue)", () => {
    const { issue, ...rest } = validTaskBundle();
    const result = TaskBundleSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects when definitionOfDone is not an array", () => {
    const result = TaskBundleSchema.safeParse({
      ...validTaskBundle(),
      definitionOfDone: "done",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when a nested field is invalid (issue.priority out of range)", () => {
    const result = TaskBundleSchema.safeParse({
      ...validTaskBundle(),
      issue: { ...validIssue(), priority: 99 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("issue.priority");
    }
  });

  it("throws via parse() (not safeParse) on invalid input", () => {
    expect(() => TaskBundleSchema.parse({})).toThrow();
  });
});
