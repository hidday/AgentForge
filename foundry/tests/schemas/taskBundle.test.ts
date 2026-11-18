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
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      labels: ["bug"],
      priority: 2,
    },
    repo: {
      name: "acme/backend",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp/acme",
      allowedPaths: ["src/"],
      protectedPaths: [".github/"],
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

describe("IssueSchema", () => {
  it("accepts a valid issue including optional project and cycle", () => {
    const result = IssueSchema.safeParse({
      id: "LIN-1",
      title: "Title",
      description: "Description",
      labels: [],
      priority: 0,
      project: "Backend",
      cycle: "Sprint 1",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid issue without the optional fields", () => {
    const result = IssueSchema.safeParse({
      id: "LIN-1",
      title: "Title",
      description: "Description",
      labels: [],
      priority: 4,
    });
    expect(result.success).toBe(true);
  });

  it.each([-1, 5, 1.5])("rejects a priority outside the 0-4 integer range (%s)", (priority) => {
    const result = IssueSchema.safeParse({
      id: "LIN-1",
      title: "Title",
      description: "Description",
      labels: [],
      priority,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const result = IssueSchema.safeParse({
      title: "Title",
      description: "Description",
      labels: [],
      priority: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a valid repo config", () => {
    const result = RepoConfigSchema.safeParse({
      name: "acme/backend",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp/acme",
      allowedPaths: ["src/"],
      protectedPaths: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects when allowedPaths is not an array", () => {
    const result = RepoConfigSchema.safeParse({
      name: "acme/backend",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp/acme",
      allowedPaths: "src/",
      protectedPaths: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("accepts valid constraints", () => {
    const result = ConstraintsSchema.safeParse({
      requiredChecks: ["lint"],
      maxFilesChanged: 5,
      maxDiffLines: 100,
      forbiddenPatterns: [],
      mustNotTouch: [],
    });
    expect(result.success).toBe(true);
  });

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

  it("rejects a non-integer maxDiffLines", () => {
    const result = ConstraintsSchema.safeParse({
      requiredChecks: [],
      maxFilesChanged: 5,
      maxDiffLines: 100.5,
      forbiddenPatterns: [],
      mustNotTouch: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a related issue with optional fields omitted", () => {
    const result = RelatedIssueSchema.safeParse({
      id: "p1",
      title: "Parent",
      description: "Parent desc",
      state: "In Progress",
      labels: [],
      priority: 1,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a related issue with identifier and url provided", () => {
    const result = RelatedIssueSchema.safeParse({
      id: "p1",
      identifier: "PRY-100",
      title: "Parent",
      description: "Parent desc",
      state: "In Progress",
      labels: ["epic"],
      priority: 1,
      url: "https://linear.app/team/issue/PRY-100",
    });
    expect(result.success).toBe(true);
  });
});

describe("RelatedContextSchema", () => {
  it("accepts an empty blockers array and no parent", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("accepts a parent and non-empty blockers list", () => {
    const relatedIssue = {
      id: "b1",
      title: "Blocker",
      description: "desc",
      state: "Todo",
      labels: [],
      priority: 1,
    };
    const result = RelatedContextSchema.safeParse({
      parent: relatedIssue,
      blockers: [relatedIssue],
    });
    expect(result.success).toBe(true);
  });

  it("rejects when blockers is missing", () => {
    const result = RelatedContextSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  it("accepts a fully valid task bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse(makeValidTaskBundle());
    expect(result.success).toBe(true);
  });

  it("accepts a fully valid task bundle with relatedContext", () => {
    const bundle = {
      ...makeValidTaskBundle(),
      relatedContext: {
        blockers: [
          {
            id: "b1",
            title: "Blocker",
            description: "desc",
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

  it("rejects a bundle missing the required issue field", () => {
    const bundle = makeValidTaskBundle() as Record<string, unknown>;
    delete bundle.issue;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects a bundle with an invalid nested constraints value", () => {
    const bundle = makeValidTaskBundle();
    bundle.constraints.maxFilesChanged = -5;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "constraints.maxFilesChanged")).toBe(
        true,
      );
    }
  });
});
