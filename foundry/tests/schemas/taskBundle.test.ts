import { describe, it, expect } from "vitest";
import {
  IssueSchema,
  RepoConfigSchema,
  ConstraintsSchema,
  RelatedIssueSchema,
  RelatedContextSchema,
  TaskBundleSchema,
} from "../../src/schemas/taskBundle.js";

function validBundle() {
  return {
    issue: {
      id: "LIN-1",
      title: "Fix bug",
      description: "desc",
      labels: ["bug"],
      priority: 2,
    },
    repo: {
      name: "acme/backend",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp/repo",
      allowedPaths: ["src/"],
      protectedPaths: [],
    },
    constraints: {
      requiredChecks: ["lint"],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: ["All tests pass"],
  };
}

describe("TaskBundleSchema", () => {
  it("accepts a fully valid bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse(validBundle());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relatedContext).toBeUndefined();
      expect(result.data.issue.id).toBe("LIN-1");
    }
  });

  it("accepts a valid bundle including optional relatedContext with a parent and blockers", () => {
    const bundle = {
      ...validBundle(),
      relatedContext: {
        parent: {
          id: "p1",
          identifier: "PRY-100",
          title: "Parent",
          description: "desc",
          state: "In Progress",
          labels: [],
          priority: 1,
          url: "https://linear.app/x",
        },
        blockers: [
          {
            id: "b1",
            title: "Blocker",
            description: "desc",
            state: "Todo",
            labels: [],
            priority: 0,
          },
        ],
      },
    };
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
  });

  it("rejects a bundle missing a required top-level field", () => {
    const bundle = validBundle() as Partial<ReturnType<typeof validBundle>>;
    delete bundle.constraints;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("constraints"))).toBe(true);
    }
  });

  it("rejects a bundle where issue.priority is out of the allowed 0-4 range", () => {
    const bundle = validBundle();
    bundle.issue.priority = 5;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects a negative issue.priority", () => {
    const bundle = validBundle();
    bundle.issue.priority = -1;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("accepts issue.priority at its boundary values 0 and 4", () => {
    const low = validBundle();
    low.issue.priority = 0;
    const high = validBundle();
    high.issue.priority = 4;
    expect(TaskBundleSchema.safeParse(low).success).toBe(true);
    expect(TaskBundleSchema.safeParse(high).success).toBe(true);
  });

  it("rejects a bundle with the wrong type for a field", () => {
    const bundle = validBundle() as unknown as { issue: { labels: unknown } };
    bundle.issue.labels = "not-an-array";
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects definitionOfDone that isn't an array of strings", () => {
    const bundle = validBundle() as unknown as { definitionOfDone: unknown };
    bundle.definitionOfDone = "not an array";
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects maxFilesChanged that is zero or negative (must be positive)", () => {
    const bundle = validBundle();
    bundle.constraints.maxFilesChanged = 0;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer maxDiffLines", () => {
    const bundle = validBundle();
    bundle.constraints.maxDiffLines = 1.5;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });
});

describe("IssueSchema", () => {
  it("allows omitting the optional project and cycle fields", () => {
    const result = IssueSchema.safeParse({
      id: "LIN-1",
      title: "t",
      description: "d",
      labels: [],
      priority: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing required title", () => {
    const result = IssueSchema.safeParse({
      id: "LIN-1",
      description: "d",
      labels: [],
      priority: 1,
    });
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a fully specified repo config", () => {
    const result = RepoConfigSchema.safeParse({
      name: "repo",
      defaultBranch: "main",
      workingBranch: "ai/x",
      repoPath: "/tmp",
      allowedPaths: [],
      protectedPaths: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a config where allowedPaths is missing", () => {
    const result = RepoConfigSchema.safeParse({
      name: "repo",
      defaultBranch: "main",
      workingBranch: "ai/x",
      repoPath: "/tmp",
      protectedPaths: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("rejects negative maxFilesChanged and maxDiffLines", () => {
    const result = ConstraintsSchema.safeParse({
      requiredChecks: [],
      maxFilesChanged: -1,
      maxDiffLines: -1,
      forbiddenPatterns: [],
      mustNotTouch: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("RelatedIssueSchema / RelatedContextSchema", () => {
  it("accepts a related issue without the optional identifier and url", () => {
    const result = RelatedIssueSchema.safeParse({
      id: "b1",
      title: "t",
      description: "d",
      state: "Todo",
      labels: [],
      priority: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty blockers array with no parent", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("rejects a related issue with priority above the max boundary", () => {
    const result = RelatedIssueSchema.safeParse({
      id: "b1",
      title: "t",
      description: "d",
      state: "Todo",
      labels: [],
      priority: 5,
    });
    expect(result.success).toBe(false);
  });
});
