import { describe, it, expect } from "vitest";
import {
  TaskBundleSchema,
  IssueSchema,
  RepoConfigSchema,
  ConstraintsSchema,
  RelatedIssueSchema,
  RelatedContextSchema,
} from "../../src/schemas/taskBundle.js";

const validIssue = {
  id: "LIN-1",
  title: "Fix bug",
  description: "Something broke",
  labels: ["bug"],
  priority: 2,
};

const validRepo = {
  name: "acme/backend",
  defaultBranch: "main",
  workingBranch: "feature/foo",
  repoPath: "/repos/acme",
  allowedPaths: ["src/"],
  protectedPaths: [".github/"],
};

const validConstraints = {
  requiredChecks: ["lint", "test"],
  maxFilesChanged: 10,
  maxDiffLines: 500,
  forbiddenPatterns: ["console.log"],
  mustNotTouch: ["prisma/migrations/"],
};

const validBundle = {
  issue: validIssue,
  repo: validRepo,
  constraints: validConstraints,
  definitionOfDone: ["All tests pass"],
};

describe("TaskBundleSchema", () => {
  it("accepts a fully valid minimal bundle", () => {
    const result = TaskBundleSchema.safeParse(validBundle);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.issue.id).toBe("LIN-1");
      expect(result.data.relatedContext).toBeUndefined();
    }
  });

  it("accepts a bundle with optional issue fields and relatedContext populated", () => {
    const bundle = {
      ...validBundle,
      issue: { ...validIssue, project: "Backend", cycle: "Sprint 1" },
      relatedContext: {
        parent: {
          id: "LIN-0",
          identifier: "LIN-0",
          title: "Parent issue",
          description: "desc",
          state: "Todo",
          labels: [],
          priority: 1,
          url: "https://linear.app/x",
        },
        blockers: [
          {
            id: "LIN-2",
            title: "Blocker",
            description: "blocks this",
            state: "In Progress",
            labels: ["blocked"],
            priority: 0,
          },
        ],
      },
    };
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relatedContext?.parent?.identifier).toBe("LIN-0");
      expect(result.data.relatedContext?.blockers).toHaveLength(1);
    }
  });

  it("rejects a bundle missing required fields", () => {
    const { issue: _issue, ...rest } = validBundle;
    const result = TaskBundleSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects an issue with priority out of range", () => {
    const result = IssueSchema.safeParse({ ...validIssue, priority: 5 });
    expect(result.success).toBe(false);
  });

  it("rejects an issue with priority below 0", () => {
    const result = IssueSchema.safeParse({ ...validIssue, priority: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer priority", () => {
    const result = IssueSchema.safeParse({ ...validIssue, priority: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects repo config missing a required string field", () => {
    const { repoPath: _repoPath, ...rest } = validRepo;
    const result = RepoConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects constraints with a non-positive maxFilesChanged", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints, maxFilesChanged: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects constraints with a non-positive maxDiffLines", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints, maxDiffLines: -5 });
    expect(result.success).toBe(false);
  });

  it("accepts a related issue without optional identifier/url", () => {
    const result = RelatedIssueSchema.safeParse({
      id: "LIN-3",
      title: "No identifier",
      description: "desc",
      state: "Todo",
      labels: [],
      priority: 2,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a related context with no parent and empty blockers", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("rejects a related context missing blockers", () => {
    const result = RelatedContextSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects definitionOfDone that is not an array of strings", () => {
    const result = TaskBundleSchema.safeParse({ ...validBundle, definitionOfDone: "not an array" });
    expect(result.success).toBe(false);
  });
});
