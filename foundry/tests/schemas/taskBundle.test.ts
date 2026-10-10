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
    title: "Add feature",
    description: "Description",
    labels: ["bug"],
    priority: 2,
  };
}

function validRepoConfig() {
  return {
    name: "acme/repo",
    defaultBranch: "main",
    workingBranch: "ai/lin-1",
    repoPath: "/tmp/repo",
    allowedPaths: ["src/"],
    protectedPaths: [".github/"],
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

function validRelatedIssue() {
  return {
    id: "LIN-2",
    identifier: "LIN-2",
    title: "Parent issue",
    description: "Parent description",
    state: "In Progress",
    labels: [],
    priority: 1,
    url: "https://linear.app/team/issue/LIN-2",
  };
}

describe("IssueSchema", () => {
  it("accepts a valid issue including optional project/cycle", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), project: "Platform", cycle: "Sprint 1" });
    expect(result.success).toBe(true);
  });

  it("accepts a valid issue without the optional fields", () => {
    const result = IssueSchema.safeParse(validIssue());
    expect(result.success).toBe(true);
  });

  it("rejects priority below the 0 minimum", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects priority above the 4 maximum", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 5 });
    expect(result.success).toBe(false);
  });

  it("accepts the boundary priority values 0 and 4", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 0 }).success).toBe(true);
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 4 }).success).toBe(true);
  });

  it("rejects a non-integer priority", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { title, ...rest } = validIssue();
    expect(title).toBeDefined();
    const result = IssueSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a valid repo config", () => {
    expect(RepoConfigSchema.safeParse(validRepoConfig()).success).toBe(true);
  });

  it("rejects when allowedPaths is not an array of strings", () => {
    const result = RepoConfigSchema.safeParse({ ...validRepoConfig(), allowedPaths: "src/" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing name field", () => {
    const { name, ...rest } = validRepoConfig();
    expect(name).toBeDefined();
    expect(RepoConfigSchema.safeParse(rest).success).toBe(false);
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
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxDiffLines: -10 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer maxFilesChanged", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: 2.5 });
    expect(result.success).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a valid related issue with optional identifier/url", () => {
    expect(RelatedIssueSchema.safeParse(validRelatedIssue()).success).toBe(true);
  });

  it("accepts a related issue without the optional identifier/url", () => {
    const { identifier, url, ...rest } = validRelatedIssue();
    expect(identifier).toBeDefined();
    expect(url).toBeDefined();
    expect(RelatedIssueSchema.safeParse(rest).success).toBe(true);
  });

  it("rejects priority outside the 0-4 bounds", () => {
    expect(RelatedIssueSchema.safeParse({ ...validRelatedIssue(), priority: 9 }).success).toBe(
      false,
    );
  });
});

describe("RelatedContextSchema", () => {
  it("accepts blockers with no parent", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [validRelatedIssue()] });
    expect(result.success).toBe(true);
  });

  it("accepts a parent and blockers together", () => {
    const result = RelatedContextSchema.safeParse({
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue()],
    });
    expect(result.success).toBe(true);
  });

  it("rejects when blockers is missing", () => {
    const result = RelatedContextSchema.safeParse({ parent: validRelatedIssue() });
    expect(result.success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  function validBundle() {
    return {
      issue: validIssue(),
      repo: validRepoConfig(),
      constraints: validConstraints(),
      definitionOfDone: ["All tests pass"],
    };
  }

  it("accepts a minimal valid bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse(validBundle());
    expect(result.success).toBe(true);
  });

  it("accepts a full bundle including relatedContext", () => {
    const result = TaskBundleSchema.safeParse({
      ...validBundle(),
      relatedContext: { parent: validRelatedIssue(), blockers: [validRelatedIssue()] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a bundle with an invalid nested issue (out-of-range priority)", () => {
    const bundle = validBundle();
    const result = TaskBundleSchema.safeParse({
      ...bundle,
      issue: { ...bundle.issue, priority: 10 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a bundle missing the required repo field", () => {
    const { repo, ...rest } = validBundle();
    expect(repo).toBeDefined();
    const result = TaskBundleSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects a bundle whose constraints have an invalid type", () => {
    const bundle = validBundle();
    const result = TaskBundleSchema.safeParse({
      ...bundle,
      constraints: { ...bundle.constraints, maxFilesChanged: "ten" },
    });
    expect(result.success).toBe(false);
  });
});
