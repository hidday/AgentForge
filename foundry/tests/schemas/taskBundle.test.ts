import { describe, it, expect } from "vitest";
import { TaskBundleSchema } from "../../src/schemas/taskBundle.js";

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
      name: "backend",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp/backend",
      allowedPaths: ["src/"],
      protectedPaths: [".github/"],
    },
    constraints: {
      requiredChecks: ["lint", "tests"],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: ["Tests pass"],
  };
}

describe("TaskBundleSchema", () => {
  it("parses a fully valid bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse(makeValidBundle());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relatedContext).toBeUndefined();
      expect(result.data.issue.priority).toBe(2);
    }
  });

  it("accepts optional issue fields (project, cycle) and optional repo/related-issue url", () => {
    const bundle = makeValidBundle();
    (bundle.issue as Record<string, unknown>).project = "Backend Platform";
    (bundle.issue as Record<string, unknown>).cycle = "Sprint 4";
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
  });

  it("parses a bundle including relatedContext with a parent and blockers", () => {
    const bundle = {
      ...makeValidBundle(),
      relatedContext: {
        parent: {
          id: "p1",
          identifier: "PRY-100",
          title: "Parent",
          description: "Parent desc",
          state: "In Progress",
          labels: ["epic"],
          priority: 1,
          url: "https://linear.app/team/issue/PRY-100",
        },
        blockers: [
          {
            id: "b1",
            title: "Blocker",
            description: "Blocker desc",
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
      expect(result.data.relatedContext?.parent?.identifier).toBe("PRY-100");
      expect(result.data.relatedContext?.blockers[0].url).toBeUndefined();
    }
  });

  it("rejects a bundle missing a required top-level field", () => {
    const bundle = makeValidBundle() as { constraints?: unknown };
    delete bundle.constraints;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects an issue priority outside the 0-4 range", () => {
    const bundle = makeValidBundle();
    bundle.issue.priority = 5;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects a negative issue priority", () => {
    const bundle = makeValidBundle();
    bundle.issue.priority = -1;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects non-positive maxFilesChanged / maxDiffLines constraints", () => {
    const bundle = makeValidBundle();
    bundle.constraints.maxFilesChanged = 0;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects when a required array field has the wrong element type", () => {
    const bundle = makeValidBundle() as { definitionOfDone: unknown };
    bundle.definitionOfDone = [123];
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects a relatedContext blocker missing a required field", () => {
    const bundle = {
      ...makeValidBundle(),
      relatedContext: {
        blockers: [{ id: "b1", title: "Blocker" }],
      },
    };
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });
});
