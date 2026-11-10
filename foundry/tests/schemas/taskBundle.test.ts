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
    title: "Add login",
    description: "Needs OAuth support",
    labels: ["auth"],
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
    title: "Parent",
    description: "Parent desc",
    state: "In Progress",
    labels: [],
    priority: 1,
  };
}

function validTaskBundle() {
  return {
    issue: validIssue(),
    repo: validRepoConfig(),
    constraints: validConstraints(),
    definitionOfDone: ["All tests pass"],
  };
}

describe("IssueSchema", () => {
  it("parses a valid issue", () => {
    const result = IssueSchema.parse(validIssue());
    expect(result).toEqual(validIssue());
  });

  it("accepts optional project and cycle", () => {
    const result = IssueSchema.parse({ ...validIssue(), project: "P1", cycle: "C1" });
    expect(result.project).toBe("P1");
    expect(result.cycle).toBe("C1");
  });

  it("rejects a missing required field", () => {
    const { id, ...rest } = validIssue();
    void id;
    expect(() => IssueSchema.parse(rest)).toThrow();
  });

  it("rejects a wrong type for labels", () => {
    expect(() => IssueSchema.parse({ ...validIssue(), labels: "not-an-array" })).toThrow();
  });

  it("rejects priority below the minimum (0)", () => {
    expect(() => IssueSchema.parse({ ...validIssue(), priority: -1 })).toThrow();
  });

  it("rejects priority above the maximum (4)", () => {
    expect(() => IssueSchema.parse({ ...validIssue(), priority: 5 })).toThrow();
  });

  it("rejects a non-integer priority", () => {
    expect(() => IssueSchema.parse({ ...validIssue(), priority: 1.5 })).toThrow();
  });
});

describe("RepoConfigSchema", () => {
  it("parses a valid repo config", () => {
    expect(RepoConfigSchema.parse(validRepoConfig())).toEqual(validRepoConfig());
  });

  it("rejects a missing required field", () => {
    const { repoPath, ...rest } = validRepoConfig();
    void repoPath;
    expect(() => RepoConfigSchema.parse(rest)).toThrow();
  });

  it("rejects wrong type for allowedPaths", () => {
    expect(() => RepoConfigSchema.parse({ ...validRepoConfig(), allowedPaths: "src" })).toThrow();
  });
});

describe("ConstraintsSchema", () => {
  it("parses valid constraints", () => {
    expect(ConstraintsSchema.parse(validConstraints())).toEqual(validConstraints());
  });

  it("rejects a non-positive maxFilesChanged", () => {
    expect(() => ConstraintsSchema.parse({ ...validConstraints(), maxFilesChanged: 0 })).toThrow();
  });

  it("rejects a non-integer maxDiffLines", () => {
    expect(() => ConstraintsSchema.parse({ ...validConstraints(), maxDiffLines: 1.5 })).toThrow();
  });

  it("rejects a missing forbiddenPatterns field", () => {
    const { forbiddenPatterns, ...rest } = validConstraints();
    void forbiddenPatterns;
    expect(() => ConstraintsSchema.parse(rest)).toThrow();
  });
});

describe("RelatedIssueSchema", () => {
  it("parses a valid related issue with optional fields omitted", () => {
    expect(RelatedIssueSchema.parse(validRelatedIssue())).toEqual(validRelatedIssue());
  });

  it("accepts optional identifier and url", () => {
    const withExtras = { ...validRelatedIssue(), identifier: "PRY-1", url: "https://example.com" };
    expect(RelatedIssueSchema.parse(withExtras)).toEqual(withExtras);
  });

  it("rejects a missing state field", () => {
    const { state, ...rest } = validRelatedIssue();
    void state;
    expect(() => RelatedIssueSchema.parse(rest)).toThrow();
  });
});

describe("RelatedContextSchema", () => {
  it("parses with only blockers (parent omitted)", () => {
    const result = RelatedContextSchema.parse({ blockers: [validRelatedIssue()] });
    expect(result.blockers).toHaveLength(1);
    expect(result.parent).toBeUndefined();
  });

  it("parses with both parent and blockers", () => {
    const result = RelatedContextSchema.parse({
      parent: validRelatedIssue(),
      blockers: [],
    });
    expect(result.parent).toEqual(validRelatedIssue());
    expect(result.blockers).toEqual([]);
  });

  it("rejects a missing blockers field", () => {
    expect(() => RelatedContextSchema.parse({})).toThrow();
  });
});

describe("TaskBundleSchema", () => {
  it("parses a minimal valid task bundle (relatedContext omitted)", () => {
    const result = TaskBundleSchema.parse(validTaskBundle());
    expect(result.relatedContext).toBeUndefined();
    expect(result.issue.id).toBe("LIN-1");
  });

  it("parses a full task bundle including relatedContext", () => {
    const full = {
      ...validTaskBundle(),
      relatedContext: { parent: validRelatedIssue(), blockers: [validRelatedIssue()] },
    };
    const result = TaskBundleSchema.parse(full);
    expect(result.relatedContext?.blockers).toHaveLength(1);
  });

  it("rejects when a nested field is missing", () => {
    const bundle = validTaskBundle();
    const malformed = { ...bundle, issue: { ...bundle.issue, title: undefined } };
    expect(() => TaskBundleSchema.parse(malformed)).toThrow();
  });

  it("rejects when definitionOfDone is not an array", () => {
    expect(() =>
      TaskBundleSchema.parse({ ...validTaskBundle(), definitionOfDone: "done" }),
    ).toThrow();
  });

  it("rejects entirely missing input", () => {
    expect(() => TaskBundleSchema.parse(undefined)).toThrow();
  });

  it("produces a ZodError with issues describing what failed", () => {
    const result = TaskBundleSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toEqual(
        expect.arrayContaining(["issue", "repo", "constraints", "definitionOfDone"]),
      );
    }
  });
});
