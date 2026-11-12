import { describe, it, expect } from "vitest";
import {
  TaskBundleSchema,
  IssueSchema,
  RepoConfigSchema,
  ConstraintsSchema,
  RelatedIssueSchema,
  RelatedContextSchema,
} from "../../src/schemas/taskBundle.js";

function validIssue() {
  return {
    id: "issue-1",
    title: "Add login",
    description: "Implement login flow",
    labels: ["auth"],
    priority: 2,
  };
}

function validRepo() {
  return {
    name: "main-repo",
    defaultBranch: "main",
    workingBranch: "feature/login",
    repoPath: "/repo",
    allowedPaths: ["src/"],
    protectedPaths: ["src/secrets/"],
  };
}

function validConstraints() {
  return {
    requiredChecks: ["lint", "tests"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };
}

function validBundle() {
  return {
    issue: validIssue(),
    repo: validRepo(),
    constraints: validConstraints(),
    definitionOfDone: ["All tests pass"],
  };
}

describe("TaskBundleSchema", () => {
  it("parses a minimal valid bundle without optional fields", () => {
    const result = TaskBundleSchema.parse(validBundle());
    expect(result.issue.id).toBe("issue-1");
    expect(result.relatedContext).toBeUndefined();
  });

  it("parses a full bundle including relatedContext", () => {
    const bundle = {
      ...validBundle(),
      relatedContext: {
        parent: {
          id: "parent-1",
          identifier: "LIN-1",
          title: "Parent issue",
          description: "desc",
          state: "In Progress",
          labels: [],
          priority: 1,
          url: "https://linear.app/x",
        },
        blockers: [
          {
            id: "blocker-1",
            title: "Blocker issue",
            description: "desc",
            state: "Todo",
            labels: ["blocked"],
            priority: 3,
          },
        ],
      },
    };
    const result = TaskBundleSchema.parse(bundle);
    expect(result.relatedContext?.parent?.identifier).toBe("LIN-1");
    expect(result.relatedContext?.blockers[0].id).toBe("blocker-1");
    // optional fields omitted on the blocker should be undefined
    expect(result.relatedContext?.blockers[0].url).toBeUndefined();
  });

  it("rejects a bundle missing a required field", () => {
    const bundle = validBundle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (bundle as any).repo;
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects a bundle with a wrong-typed field", () => {
    const bundle = { ...validBundle(), definitionOfDone: "not-an-array" };
    const result = TaskBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects an issue priority outside of [0, 4]", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 5 }).success).toBe(false);
    expect(IssueSchema.safeParse({ ...validIssue(), priority: -1 }).success).toBe(false);
  });

  it("accepts issue priority at the boundaries 0 and 4", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 0 }).success).toBe(true);
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 4 }).success).toBe(true);
  });

  it("rejects a non-integer priority", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 2.5 }).success).toBe(false);
  });

  it("allows issue project and cycle to be omitted", () => {
    const result = IssueSchema.safeParse(validIssue());
    expect(result.success).toBe(true);
  });

  it("validates RepoConfigSchema requires all its fields", () => {
    expect(RepoConfigSchema.safeParse(validRepo()).success).toBe(true);
    const { repoPath, ...missing } = validRepo();
    expect(repoPath).toBeDefined();
    expect(RepoConfigSchema.safeParse(missing).success).toBe(false);
  });

  it("validates ConstraintsSchema numeric fields must be positive integers", () => {
    expect(ConstraintsSchema.safeParse(validConstraints()).success).toBe(true);
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: 0 }).success,
    ).toBe(false);
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints(), maxDiffLines: -1 }).success,
    ).toBe(false);
  });

  it("validates RelatedIssueSchema allows identifier and url to be omitted", () => {
    const result = RelatedIssueSchema.safeParse({
      id: "x",
      title: "t",
      description: "d",
      state: "Todo",
      labels: [],
      priority: 1,
    });
    expect(result.success).toBe(true);
  });

  it("validates RelatedContextSchema allows parent to be omitted", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("rejects RelatedContextSchema when blockers is missing", () => {
    const result = RelatedContextSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
