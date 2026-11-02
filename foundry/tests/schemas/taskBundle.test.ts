import { describe, it, expect } from "vitest";
import {
  TaskBundleSchema,
  IssueSchema,
  RelatedContextSchema,
  ConstraintsSchema,
} from "../../src/schemas/taskBundle.js";

function validBundle() {
  return {
    issue: { id: "LIN-1", title: "t", description: "d", labels: ["bug"], priority: 2 },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp",
      allowedPaths: ["src/"],
      protectedPaths: [],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: ["All tests pass"],
  };
}

describe("TaskBundleSchema", () => {
  it("accepts a well-formed bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse(validBundle());
    expect(result.success).toBe(true);
  });

  it("accepts a bundle with relatedContext including a parent and blockers", () => {
    const bundle = {
      ...validBundle(),
      relatedContext: {
        parent: {
          id: "LIN-0",
          title: "Parent",
          description: "d",
          state: "Done",
          labels: [],
          priority: 1,
        },
        blockers: [
          {
            id: "LIN-2",
            title: "Blocker",
            description: "d",
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

  it("rejects a bundle missing required fields", () => {
    const { issue: _issue, ...rest } = validBundle();
    const result = TaskBundleSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("IssueSchema", () => {
  it("rejects a priority outside the 0-4 range", () => {
    const result = IssueSchema.safeParse({
      id: "LIN-1",
      title: "t",
      description: "d",
      labels: [],
      priority: 5,
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional project and cycle fields", () => {
    const result = IssueSchema.safeParse({
      id: "LIN-1",
      title: "t",
      description: "d",
      labels: [],
      priority: 0,
      project: "Backend",
      cycle: "Sprint 1",
    });
    expect(result.success).toBe(true);
  });
});

describe("ConstraintsSchema", () => {
  it("rejects a non-positive maxFilesChanged", () => {
    const result = ConstraintsSchema.safeParse({
      requiredChecks: [],
      maxFilesChanged: 0,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("RelatedContextSchema", () => {
  it("accepts an empty blockers array with no parent", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("rejects a blocker missing a required field", () => {
    const result = RelatedContextSchema.safeParse({
      blockers: [{ id: "LIN-2", title: "t", description: "d", labels: [], priority: 0 }],
    });
    expect(result.success).toBe(false);
  });
});
