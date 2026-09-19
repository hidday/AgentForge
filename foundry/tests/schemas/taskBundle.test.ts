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
    title: "Fix the bug",
    description: "There is a bug",
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
    requiredChecks: ["lint", "test"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: ["eval\\("],
    mustNotTouch: [".env"],
  };
}

function validRelatedIssue() {
  return {
    id: "b1",
    identifier: "PRY-101",
    title: "Blocker issue",
    description: "Must ship first",
    state: "Todo",
    labels: ["infra"],
    priority: 1,
    url: "https://linear.app/team/issue/PRY-101",
  };
}

describe("IssueSchema", () => {
  it("accepts a well-formed issue", () => {
    const result = IssueSchema.safeParse(validIssue());
    expect(result.success).toBe(true);
  });

  it("accepts an issue without the optional project/cycle fields", () => {
    const result = IssueSchema.safeParse(validIssue());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project).toBeUndefined();
      expect(result.data.cycle).toBeUndefined();
    }
  });

  it("accepts project and cycle when provided", () => {
    const result = IssueSchema.safeParse({
      ...validIssue(),
      project: "Foundry",
      cycle: "Cycle 12",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project).toBe("Foundry");
      expect(result.data.cycle).toBe("Cycle 12");
    }
  });

  it("rejects a priority above the max of 4", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 5 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative priority", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer priority", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { title: _title, ...rest } = validIssue();
    const result = IssueSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a well-formed repo config", () => {
    const result = RepoConfigSchema.safeParse(validRepo());
    expect(result.success).toBe(true);
  });

  it("rejects a repo config missing allowedPaths", () => {
    const { allowedPaths: _allowedPaths, ...rest } = validRepo();
    const result = RepoConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("accepts well-formed constraints", () => {
    const result = ConstraintsSchema.safeParse(validConstraints());
    expect(result.success).toBe(true);
  });

  it("rejects a non-positive maxFilesChanged", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive maxDiffLines", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxDiffLines: -5 });
    expect(result.success).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a fully populated related issue", () => {
    const result = RelatedIssueSchema.safeParse(validRelatedIssue());
    expect(result.success).toBe(true);
  });

  it("accepts a related issue without the optional identifier and url", () => {
    const { identifier: _identifier, url: _url, ...rest } = validRelatedIssue();
    const result = RelatedIssueSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it("rejects a related issue with priority out of range", () => {
    const result = RelatedIssueSchema.safeParse({ ...validRelatedIssue(), priority: 9 });
    expect(result.success).toBe(false);
  });
});

describe("RelatedContextSchema", () => {
  it("accepts blockers-only context with no parent", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("accepts a context with both parent and blockers", () => {
    const result = RelatedContextSchema.safeParse({
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue()],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a context missing the required blockers array", () => {
    const result = RelatedContextSchema.safeParse({});
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

  it("accepts a full, well-formed task bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse(validBundle());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relatedContext).toBeUndefined();
    }
  });

  it("accepts a task bundle with relatedContext included", () => {
    const result = TaskBundleSchema.safeParse({
      ...validBundle(),
      relatedContext: { parent: validRelatedIssue(), blockers: [validRelatedIssue()] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a bundle whose nested issue is invalid", () => {
    const result = TaskBundleSchema.safeParse({
      ...validBundle(),
      issue: { ...validIssue(), priority: 100 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a bundle missing definitionOfDone", () => {
    const { definitionOfDone: _definitionOfDone, ...rest } = validBundle();
    const result = TaskBundleSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});
