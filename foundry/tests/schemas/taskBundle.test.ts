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
      repoPath: "/workspace/repo",
      allowedPaths: ["src/"],
      protectedPaths: [".github/"],
    },
    constraints: {
      requiredChecks: ["lint", "typecheck"],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: ["eval("],
      mustNotTouch: ["prisma/migrations/"],
    },
    definitionOfDone: ["All tests pass"],
  };
}

describe("TaskBundleSchema", () => {
  it("accepts a fully-populated valid task bundle", () => {
    const result = TaskBundleSchema.safeParse(makeValidTaskBundle());
    expect(result.success).toBe(true);
  });

  it("accepts a task bundle without the optional relatedContext field", () => {
    const bundle = makeValidTaskBundle();
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relatedContext).toBeUndefined();
    }
  });

  it("accepts a task bundle with relatedContext including a parent and blockers", () => {
    const bundle = {
      ...makeValidTaskBundle(),
      relatedContext: {
        parent: {
          id: "p1",
          identifier: "PRY-100",
          title: "Parent issue",
          description: "Parent description",
          state: "In Progress",
          labels: ["epic"],
          priority: 1,
          url: "https://linear.app/team/issue/PRY-100",
        },
        blockers: [
          {
            id: "b1",
            title: "Blocker issue",
            description: "Blocker description",
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

  it("rejects a task bundle missing a required top-level field", () => {
    const bundle = makeValidTaskBundle() as Partial<ReturnType<typeof makeValidTaskBundle>>;
    delete bundle.constraints;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects a task bundle whose issue has an out-of-range priority", () => {
    const bundle = makeValidTaskBundle();
    bundle.issue.priority = 5;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects a task bundle whose issue is missing required fields", () => {
    const bundle = makeValidTaskBundle();
    // @ts-expect-error intentionally malformed for the test
    delete bundle.issue.title;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects a task bundle whose repo config is missing required fields", () => {
    const bundle = makeValidTaskBundle();
    // @ts-expect-error intentionally malformed for the test
    delete bundle.repo.defaultBranch;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects a task bundle whose constraints have a non-positive maxFilesChanged", () => {
    const bundle = makeValidTaskBundle();
    bundle.constraints.maxFilesChanged = 0;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects a task bundle where definitionOfDone is not an array of strings", () => {
    const bundle = makeValidTaskBundle() as unknown as Record<string, unknown>;
    bundle.definitionOfDone = "not an array";
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects relatedContext when a blocker is missing required fields", () => {
    const bundle = {
      ...makeValidTaskBundle(),
      relatedContext: {
        blockers: [{ id: "b1", title: "Missing fields" }],
      },
    };
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });
});

describe("IssueSchema", () => {
  it("accepts an issue with optional project/cycle omitted", () => {
    const result = IssueSchema.safeParse({
      id: "LIN-1",
      title: "Title",
      description: "Description",
      labels: [],
      priority: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts an issue with project and cycle provided", () => {
    const result = IssueSchema.safeParse({
      id: "LIN-1",
      title: "Title",
      description: "Description",
      labels: [],
      priority: 4,
      project: "Backend Platform",
      cycle: "Sprint 23",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative priority", () => {
    const result = IssueSchema.safeParse({
      id: "LIN-1",
      title: "Title",
      description: "Description",
      labels: [],
      priority: -1,
    });
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("rejects when allowedPaths is not an array", () => {
    const result = RepoConfigSchema.safeParse({
      name: "acme/backend",
      defaultBranch: "main",
      workingBranch: "ai/1",
      repoPath: "/tmp",
      allowedPaths: "src/",
      protectedPaths: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("rejects a non-positive maxDiffLines", () => {
    const result = ConstraintsSchema.safeParse({
      requiredChecks: [],
      maxFilesChanged: 5,
      maxDiffLines: -1,
      forbiddenPatterns: [],
      mustNotTouch: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a related issue without the optional identifier/url", () => {
    const result = RelatedIssueSchema.safeParse({
      id: "b1",
      title: "Blocker",
      description: "Blocker description",
      state: "Todo",
      labels: [],
      priority: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a related issue with an out-of-range priority", () => {
    const result = RelatedIssueSchema.safeParse({
      id: "b1",
      title: "Blocker",
      description: "Blocker description",
      state: "Todo",
      labels: [],
      priority: 10,
    });
    expect(result.success).toBe(false);
  });
});

describe("RelatedContextSchema", () => {
  it("accepts an empty blockers array with no parent", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("rejects when blockers is missing entirely", () => {
    const result = RelatedContextSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
