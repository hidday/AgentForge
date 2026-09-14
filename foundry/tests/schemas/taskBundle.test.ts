import { describe, it, expect } from "vitest";
import {
  TaskBundleSchema,
  IssueSchema,
  RelatedContextSchema,
  type TaskBundle,
} from "../../src/schemas/taskBundle.js";

function makeValidBundle(): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Fix bug",
      description: "Something is broken",
      labels: ["bug"],
      priority: 2,
      project: "AgentForge",
      cycle: "Cycle 4",
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp/test-repo",
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
    definitionOfDone: ["Tests pass"],
    relatedContext: {
      parent: {
        id: "LIN-0",
        identifier: "LIN-0",
        title: "Parent",
        description: "Parent issue",
        state: "Todo",
        labels: [],
        priority: 1,
        url: "https://linear.app/issue/LIN-0",
      },
      blockers: [
        {
          id: "LIN-2",
          title: "Blocker",
          description: "Blocking issue",
          state: "Todo",
          labels: [],
          priority: 3,
        },
      ],
    },
  };
}

describe("TaskBundleSchema", () => {
  it("parses a fully populated task bundle", () => {
    const bundle = makeValidBundle();
    const result = TaskBundleSchema.parse(bundle);
    expect(result).toEqual(bundle);
  });

  it("parses a minimal bundle without the optional relatedContext", () => {
    const bundle = makeValidBundle();
    delete (bundle as { relatedContext?: unknown }).relatedContext;
    const result = TaskBundleSchema.parse(bundle);
    expect(result.relatedContext).toBeUndefined();
  });

  it("parses when relatedContext has no parent (only blockers)", () => {
    const bundle = makeValidBundle();
    bundle.relatedContext = { blockers: [] };
    const result = TaskBundleSchema.parse(bundle);
    expect(result.relatedContext).toEqual({ blockers: [] });
  });

  it("rejects a bundle missing a required top-level field", () => {
    const bundle = makeValidBundle() as Record<string, unknown>;
    delete bundle.repo;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "repo")).toBe(true);
    }
  });

  it("rejects an issue with a priority above the allowed range", () => {
    const bundle = makeValidBundle();
    (bundle.issue as { priority: number }).priority = 5;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "issue.priority");
      expect(issue).toBeDefined();
    }
  });

  it("rejects an issue with a negative priority", () => {
    const bundle = makeValidBundle();
    (bundle.issue as { priority: number }).priority = -1;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer priority", () => {
    const result = IssueSchema.safeParse({
      id: "LIN-1",
      title: "t",
      description: "d",
      labels: [],
      priority: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a relatedContext missing the required blockers array", () => {
    const result = RelatedContextSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "blockers")).toBe(true);
    }
  });

  it("rejects constraints with a non-positive maxFilesChanged", () => {
    const bundle = makeValidBundle();
    bundle.constraints.maxFilesChanged = 0;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });
});
