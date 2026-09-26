import { describe, it, expect } from "vitest";
import { TaskBundleSchema } from "../../src/schemas/taskBundle.js";

function makeValidBundle() {
  return {
    issue: {
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
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
      requiredChecks: ["lint", "test"],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: ["eval\\("],
      mustNotTouch: [".env"],
    },
    definitionOfDone: ["Tests pass"],
  };
}

describe("TaskBundleSchema", () => {
  it("parses a fully valid task bundle", () => {
    const result = TaskBundleSchema.safeParse(makeValidBundle());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.issue.id).toBe("LIN-1");
      expect(result.data.relatedContext).toBeUndefined();
    }
  });

  it("parses a valid task bundle that includes optional fields (issue.project/cycle, relatedContext)", () => {
    const bundle = {
      ...makeValidBundle(),
      issue: { ...makeValidBundle().issue, project: "Growth", cycle: "Q3" },
      relatedContext: {
        parent: {
          id: "p1",
          identifier: "PRY-100",
          title: "Parent",
          description: "Parent desc",
          state: "In Progress",
          labels: [],
          priority: 1,
          url: "https://linear.app/team/issue/PRY-100",
        },
        blockers: [],
      },
    };
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.issue.project).toBe("Growth");
      expect(result.data.relatedContext?.parent?.identifier).toBe("PRY-100");
    }
  });

  it("fails when a required top-level field is missing", () => {
    const { repo: _repo, ...rest } = makeValidBundle();
    const result = TaskBundleSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "repo")).toBe(true);
    }
  });

  it("fails when issue.priority is out of range", () => {
    const bundle = makeValidBundle();
    bundle.issue.priority = 5;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("fails when issue.priority is not an integer", () => {
    const bundle = makeValidBundle();
    (bundle.issue as { priority: number }).priority = 1.5;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("fails when a field has the wrong type (labels as a string instead of an array)", () => {
    const bundle = makeValidBundle();
    (bundle.issue as unknown as { labels: unknown }).labels = "not-an-array";
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("fails when constraints.maxFilesChanged is not positive", () => {
    const bundle = makeValidBundle();
    bundle.constraints.maxFilesChanged = 0;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("fails when repo is missing required sub-fields", () => {
    const bundle = makeValidBundle();
    const { name: _name, ...rest } = bundle.repo;
    const result = TaskBundleSchema.safeParse({ ...bundle, repo: rest });
    expect(result.success).toBe(false);
  });
});
