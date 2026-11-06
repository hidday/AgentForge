import { describe, it, expect } from "vitest";
import {
  IssueSchema,
  RepoConfigSchema,
  ConstraintsSchema,
  RelatedIssueSchema,
  RelatedContextSchema,
  TaskBundleSchema,
} from "../../src/schemas/taskBundle.js";

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "ISSUE-1",
    title: "Fix the bug",
    description: "Something is broken",
    labels: ["bug"],
    priority: 2,
    project: "Project A",
    cycle: "Cycle 1",
    ...overrides,
  };
}

function makeRepoConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: "repo-a",
    defaultBranch: "main",
    workingBranch: "ai/run-1",
    repoPath: "/repo",
    allowedPaths: ["src/"],
    protectedPaths: ["secrets/"],
    ...overrides,
  };
}

function makeConstraints(overrides: Record<string, unknown> = {}) {
  return {
    requiredChecks: ["lint"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
    ...overrides,
  };
}

function makeRelatedIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "ISSUE-2",
    identifier: "ENG-2",
    title: "Blocker",
    description: "Blocks the main issue",
    state: "In Progress",
    labels: [],
    priority: 1,
    url: "https://example.com/issue/2",
    ...overrides,
  };
}

function makeBundle(overrides: Record<string, unknown> = {}) {
  return {
    issue: makeIssue(),
    repo: makeRepoConfig(),
    constraints: makeConstraints(),
    definitionOfDone: ["Tests pass"],
    ...overrides,
  };
}

describe("IssueSchema", () => {
  it("accepts a fully populated issue", () => {
    expect(IssueSchema.safeParse(makeIssue()).success).toBe(true);
  });

  it("accepts an issue without the optional project/cycle fields", () => {
    const { project, cycle, ...rest } = makeIssue();
    expect(IssueSchema.safeParse(rest).success).toBe(true);
  });

  it("accepts the minimum priority boundary (0)", () => {
    expect(IssueSchema.safeParse(makeIssue({ priority: 0 })).success).toBe(true);
  });

  it("accepts the maximum priority boundary (4)", () => {
    expect(IssueSchema.safeParse(makeIssue({ priority: 4 })).success).toBe(true);
  });

  it("rejects a priority below the minimum", () => {
    const result = IssueSchema.safeParse(makeIssue({ priority: -1 }));
    expect(result.success).toBe(false);
  });

  it("rejects a priority above the maximum", () => {
    const result = IssueSchema.safeParse(makeIssue({ priority: 5 }));
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer priority", () => {
    const result = IssueSchema.safeParse(makeIssue({ priority: 2.5 }));
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { title, ...rest } = makeIssue();
    const result = IssueSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "title")).toBe(true);
    }
  });

  it("rejects labels that are not strings", () => {
    const result = IssueSchema.safeParse(makeIssue({ labels: [1, 2] }));
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a well-formed repo config", () => {
    expect(RepoConfigSchema.safeParse(makeRepoConfig()).success).toBe(true);
  });

  it("accepts empty allowedPaths/protectedPaths arrays", () => {
    expect(
      RepoConfigSchema.safeParse(makeRepoConfig({ allowedPaths: [], protectedPaths: [] }))
        .success,
    ).toBe(true);
  });

  it("rejects a missing required field", () => {
    const { repoPath, ...rest } = makeRepoConfig();
    expect(RepoConfigSchema.safeParse(rest).success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("accepts well-formed constraints", () => {
    expect(ConstraintsSchema.safeParse(makeConstraints()).success).toBe(true);
  });

  it("rejects a zero maxFilesChanged (must be positive)", () => {
    expect(ConstraintsSchema.safeParse(makeConstraints({ maxFilesChanged: 0 })).success).toBe(
      false,
    );
  });

  it("rejects a negative maxDiffLines", () => {
    expect(ConstraintsSchema.safeParse(makeConstraints({ maxDiffLines: -10 })).success).toBe(
      false,
    );
  });

  it("rejects a non-integer maxFilesChanged", () => {
    expect(ConstraintsSchema.safeParse(makeConstraints({ maxFilesChanged: 1.5 })).success).toBe(
      false,
    );
  });

  it("accepts the smallest valid boundary (1) for maxFilesChanged and maxDiffLines", () => {
    expect(
      ConstraintsSchema.safeParse(makeConstraints({ maxFilesChanged: 1, maxDiffLines: 1 }))
        .success,
    ).toBe(true);
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a fully populated related issue", () => {
    expect(RelatedIssueSchema.safeParse(makeRelatedIssue()).success).toBe(true);
  });

  it("accepts a related issue without the optional identifier/url fields", () => {
    const { identifier, url, ...rest } = makeRelatedIssue();
    expect(RelatedIssueSchema.safeParse(rest).success).toBe(true);
  });

  it("rejects a priority outside the 0-4 range", () => {
    expect(RelatedIssueSchema.safeParse(makeRelatedIssue({ priority: 9 })).success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { state, ...rest } = makeRelatedIssue();
    expect(RelatedIssueSchema.safeParse(rest).success).toBe(false);
  });
});

describe("RelatedContextSchema", () => {
  it("accepts blockers with no parent", () => {
    const result = RelatedContextSchema.safeParse({
      blockers: [makeRelatedIssue()],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a parent plus an empty blockers array", () => {
    const result = RelatedContextSchema.safeParse({
      parent: makeRelatedIssue(),
      blockers: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-array blockers field", () => {
    const result = RelatedContextSchema.safeParse({ blockers: "not-an-array" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid nested parent issue", () => {
    const { title, ...invalidParent } = makeRelatedIssue();
    const result = RelatedContextSchema.safeParse({ parent: invalidParent, blockers: [] });
    expect(result.success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  it("accepts a complete, valid bundle without relatedContext", () => {
    const result = TaskBundleSchema.safeParse(makeBundle());
    expect(result.success).toBe(true);
  });

  it("accepts a complete, valid bundle with relatedContext", () => {
    const result = TaskBundleSchema.safeParse(
      makeBundle({
        relatedContext: {
          parent: makeRelatedIssue(),
          blockers: [makeRelatedIssue({ id: "ISSUE-3" })],
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a bundle with an invalid nested issue", () => {
    const result = TaskBundleSchema.safeParse(
      makeBundle({ issue: makeIssue({ priority: 99 }) }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "issue")).toBe(true);
    }
  });

  it("rejects a bundle missing definitionOfDone", () => {
    const { definitionOfDone, ...rest } = makeBundle();
    expect(TaskBundleSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a bundle with an invalid nested constraints object", () => {
    const result = TaskBundleSchema.safeParse(
      makeBundle({ constraints: makeConstraints({ maxFilesChanged: -5 }) }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a completely malformed payload", () => {
    expect(TaskBundleSchema.safeParse({}).success).toBe(false);
    expect(TaskBundleSchema.safeParse(null).success).toBe(false);
  });
});
