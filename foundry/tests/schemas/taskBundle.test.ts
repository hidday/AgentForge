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
    description: "Some description",
    labels: ["bug"],
    priority: 2,
  };
}

function validRepoConfig() {
  return {
    name: "test-repo",
    defaultBranch: "main",
    workingBranch: "ai/lin-1",
    repoPath: "/tmp/repo",
    allowedPaths: ["src/"],
    protectedPaths: [],
  };
}

function validConstraints() {
  return {
    requiredChecks: ["lint"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };
}

function validRelatedIssue() {
  return {
    id: "LIN-2",
    identifier: "ENG-2",
    title: "Blocker",
    description: "desc",
    state: "Todo",
    labels: [],
    priority: 1,
    url: "https://example.com/ENG-2",
  };
}

describe("IssueSchema", () => {
  it("accepts a valid issue with optional fields omitted", () => {
    const result = IssueSchema.safeParse(validIssue());
    expect(result.success).toBe(true);
  });

  it("accepts a valid issue with optional project/cycle present", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), project: "proj-1", cycle: "cycle-1" });
    expect(result.success).toBe(true);
  });

  it("rejects priority above the max of 4", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["priority"]);
    }
  });

  it("rejects priority below the min of 0", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: -1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["priority"]);
    }
  });

  it("rejects a non-integer priority", () => {
    const result = IssueSchema.safeParse({ ...validIssue(), priority: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { title, ...rest } = validIssue();
    const result = IssueSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "title")).toBe(true);
    }
    void title;
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a valid repo config", () => {
    expect(RepoConfigSchema.safeParse(validRepoConfig()).success).toBe(true);
  });

  it("rejects when allowedPaths is not an array", () => {
    const result = RepoConfigSchema.safeParse({ ...validRepoConfig(), allowedPaths: "src/" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["allowedPaths"]);
    }
  });
});

describe("ConstraintsSchema", () => {
  it("accepts valid constraints", () => {
    expect(ConstraintsSchema.safeParse(validConstraints()).success).toBe(true);
  });

  it("rejects a zero maxFilesChanged (must be positive)", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: 0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["maxFilesChanged"]);
    }
  });

  it("rejects a non-integer maxDiffLines", () => {
    const result = ConstraintsSchema.safeParse({ ...validConstraints(), maxDiffLines: 1.2 });
    expect(result.success).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a valid related issue with identifier/url present", () => {
    expect(RelatedIssueSchema.safeParse(validRelatedIssue()).success).toBe(true);
  });

  it("accepts a valid related issue without the optional identifier/url", () => {
    const { identifier, url, ...rest } = validRelatedIssue();
    expect(RelatedIssueSchema.safeParse(rest).success).toBe(true);
    void identifier;
    void url;
  });

  it("rejects an invalid priority", () => {
    const result = RelatedIssueSchema.safeParse({ ...validRelatedIssue(), priority: 10 });
    expect(result.success).toBe(false);
  });
});

describe("RelatedContextSchema", () => {
  it("accepts a context with a parent and blockers", () => {
    const result = RelatedContextSchema.safeParse({
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue()],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a context with no parent and empty blockers", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("rejects a context missing blockers", () => {
    const result = RelatedContextSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "blockers")).toBe(true);
    }
  });
});

describe("TaskBundleSchema", () => {
  function validBundle() {
    return {
      issue: validIssue(),
      repo: validRepoConfig(),
      constraints: validConstraints(),
      definitionOfDone: ["Tests pass"],
    };
  }

  it("accepts a valid bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse(validBundle());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relatedContext).toBeUndefined();
    }
  });

  it("accepts a valid bundle with relatedContext present", () => {
    const result = TaskBundleSchema.safeParse({
      ...validBundle(),
      relatedContext: { parent: validRelatedIssue(), blockers: [] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a bundle with an invalid nested issue", () => {
    const result = TaskBundleSchema.safeParse({
      ...validBundle(),
      issue: { ...validIssue(), priority: 99 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["issue", "priority"]);
    }
  });

  it("rejects a bundle missing definitionOfDone", () => {
    const { definitionOfDone, ...rest } = validBundle();
    const result = TaskBundleSchema.safeParse(rest);
    expect(result.success).toBe(false);
    void definitionOfDone;
  });
});
