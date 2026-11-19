import { describe, it, expect } from "vitest";
import {
  TaskBundleSchema,
  IssueSchema,
  ConstraintsSchema,
  RelatedContextSchema,
} from "../../src/schemas/taskBundle.js";

function makeValidBundle() {
  return {
    issue: {
      id: "LIN-1",
      title: "Test issue",
      description: "A description",
      labels: ["bug"],
      priority: 2,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp/repo",
      allowedPaths: ["src/"],
      protectedPaths: [".github/"],
    },
    constraints: {
      requiredChecks: ["lint", "test"],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: ["All tests pass"],
  };
}

describe("TaskBundleSchema", () => {
  it("accepts a fully-populated, valid bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse(makeValidBundle());
    expect(result.success).toBe(true);
  });

  it("accepts a bundle with an optional relatedContext", () => {
    const bundle = {
      ...makeValidBundle(),
      relatedContext: {
        parent: {
          id: "LIN-0",
          title: "Parent issue",
          description: "Parent desc",
          state: "In Progress",
          labels: [],
          priority: 1,
        },
        blockers: [],
      },
    };
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
  });

  it("rejects a bundle missing a required field (issue)", () => {
    const { issue, ...rest } = makeValidBundle();
    const result = TaskBundleSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects an issue priority outside the 0-4 range", () => {
    const result = IssueSchema.safeParse({
      id: "LIN-1",
      title: "x",
      description: "y",
      labels: [],
      priority: 5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative maxFilesChanged in constraints", () => {
    const result = ConstraintsSchema.safeParse({
      requiredChecks: [],
      maxFilesChanged: -1,
      maxDiffLines: 100,
      forbiddenPatterns: [],
      mustNotTouch: [],
    });
    expect(result.success).toBe(false);
  });

  it("allows relatedContext.parent to be omitted while blockers is required", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("rejects relatedContext when blockers is missing", () => {
    const result = RelatedContextSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
