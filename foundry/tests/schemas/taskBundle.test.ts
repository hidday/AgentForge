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
    description: "Something broke",
    labels: ["bug"],
    priority: 2,
  };
}

function validRepoConfig() {
  return {
    name: "acme/widgets",
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
    id: "rel-1",
    identifier: "PRY-100",
    title: "Related",
    description: "Related description",
    state: "Todo",
    labels: ["foo"],
    priority: 1,
    url: "https://linear.app/team/issue/PRY-100",
  };
}

describe("IssueSchema", () => {
  it("parses a valid issue", () => {
    const result = IssueSchema.safeParse(validIssue());
    expect(result.success).toBe(true);
  });

  it("allows project and cycle to be omitted (optional)", () => {
    const result = IssueSchema.safeParse(validIssue());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project).toBeUndefined();
      expect(result.data.cycle).toBeUndefined();
    }
  });

  it("accepts project and cycle when provided", () => {
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

  it("rejects priority below the 0-4 boundary", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects priority above the 0-4 boundary", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 5 });
    expect(result.success).toBe(false);
  });

  it("accepts priority at the 0 and 4 boundaries", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 0 }).success).toBe(true);
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 4 }).success).toBe(true);
  });

  it("rejects a non-integer priority", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 2.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { title: _title, ...withoutTitle } = validIssue();
    const result = IssueSchema.safeParse(withoutTitle);
    expect(result.success).toBe(false);
  });

  it("rejects labels that are not an array of strings", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), labels: "bug" });
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("parses a valid repo config", () => {
    expect(RepoConfigSchema.safeParse(validRepoConfig()).success).toBe(true);
  });

  it("rejects a repo config missing a required field", () => {
    const { repoPath: _repoPath, ...withoutRepoPath } = validRepoConfig();
    expect(RepoConfigSchema.safeParse(withoutRepoPath).success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("parses valid constraints", () => {
    expect(ConstraintsSchema.safeParse(validConstraints()).success).toBe(true);
  });

  it("rejects a non-positive maxFilesChanged", () => {
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: 0 }).success,
    ).toBe(false);
  });

  it("rejects a non-positive maxDiffLines", () => {
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints(), maxDiffLines: -5 }).success,
    ).toBe(false);
  });

  it("rejects a non-integer maxFilesChanged", () => {
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: 1.5 }).success,
    ).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("parses a valid related issue with identifier and url", () => {
    expect(RelatedIssueSchema.safeParse(validRelatedIssue()).success).toBe(true);
  });

  it("allows identifier and url to be omitted", () => {
    const { identifier: _identifier, url: _url, ...rest } = validRelatedIssue();
    const result = RelatedIssueSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it("rejects priority outside the 0-4 range", () => {
    expect(
      RelatedIssueSchema.safeParse({ ...validRelatedIssue(), priority: 10 }).success,
    ).toBe(false);
  });
});

describe("RelatedContextSchema", () => {
  it("parses with a parent and blockers", () => {
    const result = RelatedContextSchema.safeParse({
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue()],
    });
    expect(result.success).toBe(true);
  });

  it("allows parent to be omitted while blockers is required", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("rejects when blockers is missing", () => {
    const result = RelatedContextSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects when blockers contains an invalid related issue", () => {
    const result = RelatedContextSchema.safeParse({
      blockers: [{ ...validRelatedIssue(), priority: -1 }],
    });
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

  it("parses a valid task bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse(validBundle());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relatedContext).toBeUndefined();
    }
  });

  it("parses a valid task bundle with relatedContext", () => {
    const result = TaskBundleSchema.safeParse({
      ...validBundle(),
      relatedContext: { parent: validRelatedIssue(), blockers: [validRelatedIssue()] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relatedContext?.blockers).toHaveLength(1);
    }
  });

  it("rejects when a nested schema (issue) is invalid", () => {
    const result = TaskBundleSchema.safeParse({
      ...validBundle(),
      issue: { ...validIssue(), priority: 99 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects when definitionOfDone is missing", () => {
    const { definitionOfDone: _definitionOfDone, ...withoutDoD } = validBundle();
    const result = TaskBundleSchema.safeParse(withoutDoD);
    expect(result.success).toBe(false);
  });

  it("rejects a completely empty object with a clear multi-field error", () => {
    const result = TaskBundleSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toEqual(
        expect.arrayContaining(["issue", "repo", "constraints", "definitionOfDone"]),
      );
    }
  });
});
