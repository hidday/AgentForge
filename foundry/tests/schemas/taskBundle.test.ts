import { describe, it, expect } from "vitest";
import {
  TaskBundleSchema,
  IssueSchema,
  RepoConfigSchema,
  ConstraintsSchema,
  RelatedIssueSchema,
  RelatedContextSchema,
} from "../../src/schemas/taskBundle.js";

function makeValidBundle() {
  return {
    issue: {
      id: "LIN-1",
      title: "Add validation",
      description: "Some description",
      labels: ["bug"],
      priority: 2,
    },
    repo: {
      name: "acme/widgets",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp/repo",
      allowedPaths: ["src/"],
      protectedPaths: [],
    },
    constraints: {
      requiredChecks: ["lint", "typecheck"],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: ["All tests pass"],
  };
}

describe("IssueSchema", () => {
  it("accepts a minimal valid issue", () => {
    const result = IssueSchema.safeParse({
      id: "i1",
      title: "T",
      description: "D",
      labels: [],
      priority: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts the optional project and cycle fields", () => {
    const result = IssueSchema.safeParse({
      id: "i1",
      title: "T",
      description: "D",
      labels: [],
      priority: 4,
      project: "Backend",
      cycle: "Sprint 1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects priority below the minimum (0)", () => {
    const result = IssueSchema.safeParse({
      id: "i1",
      title: "T",
      description: "D",
      labels: [],
      priority: -1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["priority"]);
    }
  });

  it("rejects priority above the maximum (4)", () => {
    const result = IssueSchema.safeParse({
      id: "i1",
      title: "T",
      description: "D",
      labels: [],
      priority: 5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer priority", () => {
    const result = IssueSchema.safeParse({
      id: "i1",
      title: "T",
      description: "D",
      labels: [],
      priority: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects when a required field is missing", () => {
    const result = IssueSchema.safeParse({
      title: "T",
      description: "D",
      labels: [],
      priority: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "id")).toBe(true);
    }
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a valid repo config", () => {
    const result = RepoConfigSchema.safeParse({
      name: "acme/widgets",
      defaultBranch: "main",
      workingBranch: "ai/x",
      repoPath: "/tmp",
      allowedPaths: ["src/"],
      protectedPaths: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects when allowedPaths is not an array", () => {
    const result = RepoConfigSchema.safeParse({
      name: "acme/widgets",
      defaultBranch: "main",
      workingBranch: "ai/x",
      repoPath: "/tmp",
      allowedPaths: "src/",
      protectedPaths: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("rejects a non-positive maxFilesChanged", () => {
    const result = ConstraintsSchema.safeParse({
      requiredChecks: [],
      maxFilesChanged: 0,
      maxDiffLines: 100,
      forbiddenPatterns: [],
      mustNotTouch: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive maxDiffLines", () => {
    const result = ConstraintsSchema.safeParse({
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: -5,
      forbiddenPatterns: [],
      mustNotTouch: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid positive integer constraints", () => {
    const result = ConstraintsSchema.safeParse({
      requiredChecks: ["lint"],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: ["eval\\("],
      mustNotTouch: [".github/"],
    });
    expect(result.success).toBe(true);
  });
});

describe("RelatedIssueSchema / RelatedContextSchema", () => {
  it("accepts a related issue with optional fields omitted", () => {
    const result = RelatedIssueSchema.safeParse({
      id: "r1",
      title: "T",
      description: "D",
      state: "Todo",
      labels: [],
      priority: 1,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a related context with a parent and blockers", () => {
    const result = RelatedContextSchema.safeParse({
      parent: {
        id: "p1",
        title: "Parent",
        description: "D",
        state: "In Progress",
        labels: [],
        priority: 2,
      },
      blockers: [
        {
          id: "b1",
          title: "Blocker",
          description: "D",
          state: "Todo",
          labels: [],
          priority: 1,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a related context with no parent (parent optional)", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
    expect(result.success && result.data.parent).toBeUndefined();
  });
});

describe("TaskBundleSchema", () => {
  it("accepts a fully valid task bundle", () => {
    const result = TaskBundleSchema.safeParse(makeValidBundle());
    expect(result.success).toBe(true);
  });

  it("accepts a task bundle with relatedContext present", () => {
    const bundle = {
      ...makeValidBundle(),
      relatedContext: {
        blockers: [
          {
            id: "b1",
            title: "Blocker",
            description: "D",
            state: "Todo",
            labels: [],
            priority: 1,
          },
        ],
      },
    };
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
  });

  it("treats relatedContext as optional and omits it from the parsed output when absent", () => {
    const bundle = makeValidBundle();
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relatedContext).toBeUndefined();
    }
  });

  it("rejects a bundle with an invalid nested issue field", () => {
    const bundle = makeValidBundle();
    bundle.issue.priority = 10;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "issue.priority")).toBe(true);
    }
  });

  it("rejects a bundle missing the top-level repo field", () => {
    const bundle = makeValidBundle() as Record<string, unknown>;
    delete bundle.repo;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects a bundle with a non-array definitionOfDone", () => {
    const bundle = makeValidBundle() as unknown as Record<string, unknown>;
    bundle.definitionOfDone = "not an array";
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });
});
