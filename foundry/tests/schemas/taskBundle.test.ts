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
      title: "Fix the bug",
      description: "A detailed description",
      labels: ["bug"],
      priority: 2,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/workspace/test-repo",
      allowedPaths: ["src/"],
      protectedPaths: ["src/generated/"],
    },
    constraints: {
      requiredChecks: ["lint", "typecheck", "test"],
      maxFilesChanged: 20,
      maxDiffLines: 1000,
      forbiddenPatterns: ["eval("],
      mustNotTouch: [".env"],
    },
    definitionOfDone: ["Tests pass", "No lint errors"],
  };
}

describe("schemas/taskBundle", () => {
  describe("TaskBundleSchema", () => {
    it("accepts a fully valid bundle without relatedContext", () => {
      const bundle = makeValidBundle();
      const result = TaskBundleSchema.safeParse(bundle);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.issue.id).toBe("LIN-1");
        expect(result.data.relatedContext).toBeUndefined();
      }
    });

    it("accepts a valid bundle with relatedContext (parent and blockers)", () => {
      const bundle = {
        ...makeValidBundle(),
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
      if (result.success) {
        expect(result.data.relatedContext?.parent?.identifier).toBe("PRY-100");
        expect(result.data.relatedContext?.blockers).toHaveLength(1);
      }
    });

    it("rejects a bundle missing a required top-level field", () => {
      const bundle = makeValidBundle() as Record<string, unknown>;
      delete bundle.definitionOfDone;
      const result = TaskBundleSchema.safeParse(bundle);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === "definitionOfDone")).toBe(true);
      }
    });

    it("rejects a bundle with a missing required nested field", () => {
      const bundle = makeValidBundle();
      // @ts-expect-error -- intentionally deleting a required field for the test
      delete bundle.issue.labels;
      const result = TaskBundleSchema.safeParse(bundle);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.join(".") === "issue.labels")).toBe(true);
      }
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

    it("rejects a non-integer priority", () => {
      const bundle = makeValidBundle();
      bundle.issue.priority = 1.5;
      const result = TaskBundleSchema.safeParse(bundle);
      expect(result.success).toBe(false);
    });

    it("rejects wrong types for array fields (e.g. a string instead of a string array)", () => {
      const bundle = makeValidBundle() as unknown as Record<string, unknown>;
      (bundle.issue as Record<string, unknown>).labels = "bug";
      const result = TaskBundleSchema.safeParse(bundle);
      expect(result.success).toBe(false);
    });

    it("rejects non-positive constraint numbers", () => {
      const bundle = makeValidBundle();
      bundle.constraints.maxFilesChanged = 0;
      const result = TaskBundleSchema.safeParse(bundle);
      expect(result.success).toBe(false);
    });

    it("rejects relatedContext with an invalid blocker (missing required field)", () => {
      const bundle = {
        ...makeValidBundle(),
        relatedContext: {
          blockers: [{ id: "b1", title: "No description or state" }],
        },
      };
      const result = TaskBundleSchema.safeParse(bundle);
      expect(result.success).toBe(false);
    });
  });

  describe("sub-schemas", () => {
    it("IssueSchema accepts optional project and cycle fields", () => {
      const result = IssueSchema.safeParse({
        id: "LIN-2",
        title: "T",
        description: "D",
        labels: [],
        priority: 0,
        project: "Project X",
        cycle: "Cycle 5",
      });
      expect(result.success).toBe(true);
    });

    it("RepoConfigSchema requires all its fields", () => {
      const result = RepoConfigSchema.safeParse({
        name: "repo",
        defaultBranch: "main",
        // workingBranch missing
        repoPath: "/x",
        allowedPaths: [],
        protectedPaths: [],
      });
      expect(result.success).toBe(false);
    });

    it("ConstraintsSchema rejects a negative maxDiffLines", () => {
      const result = ConstraintsSchema.safeParse({
        requiredChecks: [],
        maxFilesChanged: 1,
        maxDiffLines: -5,
        forbiddenPatterns: [],
        mustNotTouch: [],
      });
      expect(result.success).toBe(false);
    });

    it("RelatedIssueSchema allows omitting identifier and url", () => {
      const result = RelatedIssueSchema.safeParse({
        id: "i1",
        title: "T",
        description: "D",
        state: "Todo",
        labels: [],
        priority: 0,
      });
      expect(result.success).toBe(true);
    });

    it("RelatedContextSchema allows omitting parent while requiring blockers", () => {
      const result = RelatedContextSchema.safeParse({ blockers: [] });
      expect(result.success).toBe(true);
    });

    it("RelatedContextSchema rejects a missing blockers field", () => {
      const result = RelatedContextSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
