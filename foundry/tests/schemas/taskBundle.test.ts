import { describe, it, expect } from "vitest";
import {
  IssueSchema,
  RepoConfigSchema,
  ConstraintsSchema,
  RelatedIssueSchema,
  RelatedContextSchema,
  TaskBundleSchema,
} from "../../src/schemas/taskBundle.js";

function validIssue() {
  return {
    id: "LIN-1",
    title: "Fix bug",
    description: "A bug needs fixing",
    labels: ["bug"],
    priority: 2,
  };
}

function validRepo() {
  return {
    name: "acme/repo",
    defaultBranch: "main",
    workingBranch: "ai/lin-1",
    repoPath: "/workspace/repo",
    allowedPaths: ["src/"],
    protectedPaths: [".github/"],
  };
}

function validConstraints() {
  return {
    requiredChecks: ["lint"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: ["eval\\("],
    mustNotTouch: ["prisma/migrations/"],
  };
}

function validRelatedIssue() {
  return {
    id: "p1",
    identifier: "PRY-100",
    title: "Parent",
    description: "Parent issue",
    state: "In Progress",
    labels: ["epic"],
    priority: 1,
    url: "https://linear.app/team/issue/PRY-100",
  };
}

describe("IssueSchema", () => {
  it("accepts a valid issue with optional fields omitted", () => {
    const result = IssueSchema.safeParse(validIssue());
    expect(result.success).toBe(true);
  });

  it("accepts optional project and cycle fields", () => {
    const result = IssueSchema.safeParse({
      ...validIssue(),
      project: "Backend",
      cycle: "Sprint 1",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project).toBe("Backend");
      expect(result.data.cycle).toBe("Sprint 1");
    }
  });

  it("rejects priority below the minimum boundary", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects priority above the maximum boundary", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 5 });
    expect(result.success).toBe(false);
  });

  it("accepts priority at the boundaries (0 and 4)", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 0 }).success).toBe(true);
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 4 }).success).toBe(true);
  });

  it("rejects a non-integer priority", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { title: _title, ...rest } = validIssue();
    const result = IssueSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects a non-array labels field", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), labels: "bug" });
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a valid repo config", () => {
    expect(RepoConfigSchema.safeParse(validRepo()).success).toBe(true);
  });

  it("rejects when allowedPaths is missing", () => {
    const { allowedPaths: _allowedPaths, ...rest } = validRepo();
    expect(RepoConfigSchema.safeParse(rest).success).toBe(false);
  });

  it("accepts empty allowedPaths and protectedPaths arrays", () => {
    const result = RepoConfigSchema.safeParse({
      ...validRepo(),
      allowedPaths: [],
      protectedPaths: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("ConstraintsSchema", () => {
  it("accepts valid constraints", () => {
    expect(ConstraintsSchema.safeParse(validConstraints()).success).toBe(true);
  });

  it("rejects a zero maxFilesChanged (must be positive)", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative maxDiffLines", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxDiffLines: -5 });
    expect(result.success).toBe(false);
  });

  it("accepts empty forbiddenPatterns and mustNotTouch arrays", () => {
    const result = ConstraintsSchema.safeParse({
      ...validConstraints(),
      forbiddenPatterns: [],
      mustNotTouch: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a valid related issue with all optional fields present", () => {
    expect(RelatedIssueSchema.safeParse(validRelatedIssue()).success).toBe(true);
  });

  it("accepts a related issue with identifier and url omitted", () => {
    const { identifier: _identifier, url: _url, ...rest } = validRelatedIssue();
    const result = RelatedIssueSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it("rejects priority outside the 0-4 range", () => {
    expect(RelatedIssueSchema.safeParse({ ...validRelatedIssue(), priority: 10 }).success).toBe(
      false,
    );
  });

  it("rejects when required 'state' field is missing", () => {
    const { state: _state, ...rest } = validRelatedIssue();
    expect(RelatedIssueSchema.safeParse(rest).success).toBe(false);
  });
});

describe("RelatedContextSchema", () => {
  it("accepts a context with both parent and blockers", () => {
    const result = RelatedContextSchema.safeParse({
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue()],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a context with parent omitted and empty blockers", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("rejects when blockers is missing entirely", () => {
    const result = RelatedContextSchema.safeParse({ parent: validRelatedIssue() });
    expect(result.success).toBe(false);
  });

  it("rejects when a blocker entry is malformed", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [{ id: "b1" }] });
    expect(result.success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  function validBundle() {
    return {
      issue: validIssue(),
      repo: validRepo(),
      constraints: validConstraints(),
      definitionOfDone: ["Tests pass"],
    };
  }

  it("accepts a minimal valid bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse(validBundle());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relatedContext).toBeUndefined();
    }
  });

  it("accepts a full bundle including relatedContext with parent and blockers", () => {
    const result = TaskBundleSchema.safeParse({
      ...validBundle(),
      relatedContext: {
        parent: validRelatedIssue(),
        blockers: [validRelatedIssue()],
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty definitionOfDone array", () => {
    const result = TaskBundleSchema.safeParse({ ...validBundle(), definitionOfDone: [] });
    expect(result.success).toBe(true);
  });

  it("rejects a bundle missing the issue field", () => {
    const { issue: _issue, ...rest } = validBundle();
    const result = TaskBundleSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects a bundle with a malformed nested repo config", () => {
    const bundle = validBundle();
    const result = TaskBundleSchema.safeParse({
      ...bundle,
      repo: { ...bundle.repo, allowedPaths: "not-an-array" },
    });
    expect(result.success).toBe(false);
  });

  it("surfaces nested validation errors with a path pointing at the failing field", () => {
    const bundle = validBundle();
    const result = TaskBundleSchema.safeParse({
      ...bundle,
      constraints: { ...bundle.constraints, maxFilesChanged: -1 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("constraints.maxFilesChanged");
    }
  });
});
