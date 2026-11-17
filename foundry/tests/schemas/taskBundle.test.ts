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
      title: "Add feature",
      description: "Do the thing",
      labels: ["bug"],
      priority: 2,
      project: "Backend",
      cycle: "Sprint 1",
    },
    repo: {
      name: "test-repo",
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
  it("parses a fully-populated, valid task bundle", () => {
    const bundle = makeValidTaskBundle();
    const result = TaskBundleSchema.parse(bundle);
    expect(result.issue.id).toBe("LIN-1");
    expect(result.relatedContext).toBeUndefined();
  });

  it("parses without optional project/cycle/relatedContext fields", () => {
    const bundle = makeValidTaskBundle();
    delete (bundle.issue as { project?: string }).project;
    delete (bundle.issue as { cycle?: string }).cycle;
    const result = TaskBundleSchema.parse(bundle);
    expect(result.issue.project).toBeUndefined();
    expect(result.issue.cycle).toBeUndefined();
  });

  it("parses with relatedContext containing a parent and blockers", () => {
    const bundle = {
      ...makeValidTaskBundle(),
      relatedContext: {
        parent: {
          id: "p1",
          identifier: "PRY-1",
          title: "Parent",
          description: "desc",
          state: "In Progress",
          labels: [],
          priority: 1,
          url: "https://linear.app/x",
        },
        blockers: [],
      },
    };
    const result = TaskBundleSchema.parse(bundle);
    expect(result.relatedContext?.parent?.identifier).toBe("PRY-1");
  });

  it("rejects a task bundle missing the required issue field", () => {
    const bundle = makeValidTaskBundle() as Record<string, unknown>;
    delete bundle.issue;
    expect(() => TaskBundleSchema.parse(bundle)).toThrow();
  });

  it("rejects a task bundle missing the required repo field", () => {
    const bundle = makeValidTaskBundle() as Record<string, unknown>;
    delete bundle.repo;
    expect(() => TaskBundleSchema.parse(bundle)).toThrow();
  });

  it("rejects a task bundle missing the required constraints field", () => {
    const bundle = makeValidTaskBundle() as Record<string, unknown>;
    delete bundle.constraints;
    expect(() => TaskBundleSchema.parse(bundle)).toThrow();
  });

  it("rejects a task bundle missing the required definitionOfDone field", () => {
    const bundle = makeValidTaskBundle() as Record<string, unknown>;
    delete bundle.definitionOfDone;
    expect(() => TaskBundleSchema.parse(bundle)).toThrow();
  });
});

describe("IssueSchema", () => {
  it("rejects a priority below the minimum of 0", () => {
    const result = IssueSchema.safeParse({
      id: "i1",
      title: "t",
      description: "d",
      labels: [],
      priority: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a priority above the maximum of 4", () => {
    const result = IssueSchema.safeParse({
      id: "i1",
      title: "t",
      description: "d",
      labels: [],
      priority: 5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer priority", () => {
    const result = IssueSchema.safeParse({
      id: "i1",
      title: "t",
      description: "d",
      labels: [],
      priority: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("accepts boundary priority values 0 and 4", () => {
    expect(
      IssueSchema.safeParse({ id: "i1", title: "t", description: "d", labels: [], priority: 0 })
        .success,
    ).toBe(true);
    expect(
      IssueSchema.safeParse({ id: "i1", title: "t", description: "d", labels: [], priority: 4 })
        .success,
    ).toBe(true);
  });
});

describe("RepoConfigSchema", () => {
  it("rejects when a required string field is missing", () => {
    const result = RepoConfigSchema.safeParse({
      name: "repo",
      defaultBranch: "main",
      workingBranch: "ai/x",
      // repoPath missing
      allowedPaths: [],
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
      maxFilesChanged: 5,
      maxDiffLines: -10,
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
      title: "Blocker",
      description: "desc",
      state: "Todo",
      labels: [],
      priority: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a related context whose blockers entry is invalid", () => {
    const result = RelatedContextSchema.safeParse({
      blockers: [{ id: "b1", title: "t" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts an empty blockers array with no parent", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });
});
