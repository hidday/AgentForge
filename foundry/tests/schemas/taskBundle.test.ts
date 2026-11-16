import { describe, it, expect } from "vitest";
import { TaskBundleSchema } from "../../src/schemas/taskBundle.js";

function makeValidBundle() {
  return {
    issue: {
      id: "LIN-1",
      title: "Fix the bug",
      description: "Detailed description",
      labels: ["bug"],
      priority: 2,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp/repo",
      allowedPaths: ["src/"],
      protectedPaths: ["src/secrets/"],
    },
    constraints: {
      requiredChecks: ["lint", "typecheck"],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: ["eval("],
      mustNotTouch: ["src/secrets/"],
    },
    definitionOfDone: ["Tests pass", "Docs updated"],
  };
}

describe("TaskBundleSchema", () => {
  it("parses successfully for a fully valid object without relatedContext", () => {
    const bundle = makeValidBundle();

    const result = TaskBundleSchema.safeParse(bundle);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relatedContext).toBeUndefined();
      expect(result.data.issue.id).toBe("LIN-1");
    }
  });

  it("parses successfully for a fully valid object with relatedContext", () => {
    const bundle = {
      ...makeValidBundle(),
      relatedContext: {
        parent: {
          id: "p1",
          identifier: "LIN-0",
          title: "Parent epic",
          description: "Umbrella feature",
          state: "In Progress",
          labels: ["epic"],
          priority: 1,
          url: "https://linear.app/team/issue/LIN-0",
        },
        blockers: [
          {
            id: "b1",
            title: "Migration",
            description: "Must land first",
            state: "Todo",
            labels: [],
            priority: 0,
          },
        ],
      },
    };

    const result = TaskBundleSchema.safeParse(bundle);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relatedContext?.parent?.id).toBe("p1");
      expect(result.data.relatedContext?.blockers).toHaveLength(1);
    }
  });

  it("fails when a required field (issue) is missing", () => {
    const bundle = makeValidBundle() as Record<string, unknown>;
    delete bundle.issue;

    const result = TaskBundleSchema.safeParse(bundle);

    expect(result.success).toBe(false);
  });

  it("fails when issue.priority is below the 0-4 range", () => {
    const bundle = makeValidBundle();
    bundle.issue.priority = -1;

    const result = TaskBundleSchema.safeParse(bundle);

    expect(result.success).toBe(false);
  });

  it("fails when issue.priority is above the 0-4 range", () => {
    const bundle = makeValidBundle();
    bundle.issue.priority = 5;

    const result = TaskBundleSchema.safeParse(bundle);

    expect(result.success).toBe(false);
  });

  it("fails when issue.priority is not an integer", () => {
    const bundle = makeValidBundle();
    bundle.issue.priority = 2.5;

    const result = TaskBundleSchema.safeParse(bundle);

    expect(result.success).toBe(false);
  });
});
