import { describe, it, expect } from "vitest";
import {
  IssueSchema,
  RepoConfigSchema,
  ConstraintsSchema,
  RelatedIssueSchema,
  RelatedContextSchema,
  TaskBundleSchema,
} from "../../src/schemas/taskBundle.js";

function makeValidTaskBundle() {
  return {
    issue: {
      id: "LIN-1042",
      title: "Add request validation middleware",
      description: "Add Zod-based request validation to all POST/PUT endpoints.",
      labels: ["bug", "api"],
      priority: 2,
      project: "Backend Platform",
      cycle: "Sprint 23",
    },
    repo: {
      name: "acme/backend-api",
      defaultBranch: "main",
      workingBranch: "ai/lin-1042",
      repoPath: "./workspace",
      allowedPaths: ["src/", "tests/"],
      protectedPaths: [".github/"],
    },
    constraints: {
      requiredChecks: ["lint", "typecheck", "tests"],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: ["console\\.log"],
      mustNotTouch: ["prisma/migrations/"],
    },
    definitionOfDone: ["All tests pass", "No lint errors"],
    relatedContext: {
      parent: {
        id: "p1",
        identifier: "PRY-100",
        title: "Umbrella feature",
        description: "Roll-up epic.",
        state: "In Progress",
        labels: ["epic"],
        priority: 1,
        url: "https://linear.app/team/issue/PRY-100",
      },
      blockers: [
        {
          id: "b1",
          title: "Prerequisite migration",
          description: "Must land first.",
          state: "Todo",
          labels: ["infra"],
          priority: 0,
        },
      ],
    },
  };
}

describe("TaskBundleSchema", () => {
  it("parses a fully well-formed task bundle and preserves the exact shape", () => {
    const input = makeValidTaskBundle();
    const result = TaskBundleSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(input);
    }
  });

  it("parses a minimal task bundle without the optional relatedContext field", () => {
    const { relatedContext: _relatedContext, ...minimal } = makeValidTaskBundle();
    const result = TaskBundleSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relatedContext).toBeUndefined();
    }
  });

  it("fails when a required top-level field is missing", () => {
    const { repo: _repo, ...missingRepo } = makeValidTaskBundle();
    const result = TaskBundleSchema.safeParse(missingRepo);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "repo")).toBe(true);
    }
  });

  it("fails when issue.priority is out of the allowed 0-4 range", () => {
    const input = makeValidTaskBundle();
    input.issue.priority = 5;
    const result = TaskBundleSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "issue.priority")).toBe(true);
    }
  });

  it("fails when constraints.maxFilesChanged is not a positive integer", () => {
    const input = makeValidTaskBundle();
    input.constraints.maxFilesChanged = 0;
    const result = TaskBundleSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("fails when a field has the wrong type (e.g. labels is not an array)", () => {
    const input = { ...makeValidTaskBundle() };
    // @ts-expect-error intentionally malformed for the test
    input.issue = { ...input.issue, labels: "not-an-array" };
    const result = TaskBundleSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("IssueSchema", () => {
  it("accepts an issue without the optional project/cycle fields", () => {
    const result = IssueSchema.safeParse({
      id: "LIN-1",
      title: "T",
      description: "D",
      labels: [],
      priority: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing required field", () => {
    const result = IssueSchema.safeParse({
      title: "T",
      description: "D",
      labels: [],
      priority: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a well-formed repo config", () => {
    const result = RepoConfigSchema.safeParse({
      name: "acme/backend-api",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "./workspace",
      allowedPaths: ["src/"],
      protectedPaths: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a repo config missing allowedPaths", () => {
    const result = RepoConfigSchema.safeParse({
      name: "acme/backend-api",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "./workspace",
      protectedPaths: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("accepts well-formed constraints", () => {
    const result = ConstraintsSchema.safeParse({
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative maxDiffLines", () => {
    const result = ConstraintsSchema.safeParse({
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: -1,
      forbiddenPatterns: [],
      mustNotTouch: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a related issue without the optional identifier/url fields", () => {
    const result = RelatedIssueSchema.safeParse({
      id: "b1",
      title: "T",
      description: "D",
      state: "Todo",
      labels: [],
      priority: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a priority above the max of 4", () => {
    const result = RelatedIssueSchema.safeParse({
      id: "b1",
      title: "T",
      description: "D",
      state: "Todo",
      labels: [],
      priority: 5,
    });
    expect(result.success).toBe(false);
  });
});

describe("RelatedContextSchema", () => {
  it("accepts a context with only blockers and no parent", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("rejects a context missing the required blockers array", () => {
    const result = RelatedContextSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
