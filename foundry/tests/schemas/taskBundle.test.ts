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
    title: "Add validation",
    description: "desc",
    labels: ["bug"],
    priority: 2,
  };
}

function validRepoConfig() {
  return {
    name: "org/repo",
    defaultBranch: "main",
    workingBranch: "feature/x",
    repoPath: "/tmp/repo",
    allowedPaths: ["src/"],
    protectedPaths: ["src/config/"],
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
    title: "Parent issue",
    description: "parent desc",
    state: "In Progress",
    labels: [],
    priority: 1,
  };
}

describe("IssueSchema", () => {
  it("accepts a well-formed issue with optional fields omitted", () => {
    expect(() => IssueSchema.parse(validIssue())).not.toThrow();
  });

  it("accepts optional project and cycle fields", () => {
    const parsed = IssueSchema.parse({ ...validIssue(), project: "Q1", cycle: "cycle-3" });
    expect(parsed.project).toBe("Q1");
    expect(parsed.cycle).toBe("cycle-3");
  });

  it("rejects a priority outside the 0-4 range", () => {
    expect(() => IssueSchema.parse({ ...validIssue(), priority: 5 })).toThrow();
  });

  it("rejects a non-integer priority", () => {
    expect(() => IssueSchema.parse({ ...validIssue(), priority: 1.5 })).toThrow();
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a well-formed repo config", () => {
    expect(() => RepoConfigSchema.parse(validRepoConfig())).not.toThrow();
  });

  it("rejects a config missing required fields", () => {
    const { defaultBranch, ...rest } = validRepoConfig();
    expect(defaultBranch).toBeDefined();
    expect(() => RepoConfigSchema.parse(rest)).toThrow();
  });
});

describe("ConstraintsSchema", () => {
  it("accepts well-formed constraints", () => {
    expect(() => ConstraintsSchema.parse(validConstraints())).not.toThrow();
  });

  it("rejects a non-positive maxFilesChanged", () => {
    expect(() => ConstraintsSchema.parse({ ...validConstraints(), maxFilesChanged: 0 })).toThrow();
  });

  it("rejects a non-positive maxDiffLines", () => {
    expect(() => ConstraintsSchema.parse({ ...validConstraints(), maxDiffLines: -1 })).toThrow();
  });
});

describe("RelatedIssueSchema / RelatedContextSchema", () => {
  it("accepts a related issue without the optional identifier/url", () => {
    expect(() => RelatedIssueSchema.parse(validRelatedIssue())).not.toThrow();
  });

  it("accepts a related context with a parent and blockers", () => {
    const parsed = RelatedContextSchema.parse({
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue()],
    });
    expect(parsed.blockers).toHaveLength(1);
  });

  it("accepts a related context with no parent", () => {
    const parsed = RelatedContextSchema.parse({ blockers: [] });
    expect(parsed.parent).toBeUndefined();
  });
});

describe("TaskBundleSchema", () => {
  it("accepts a fully-formed task bundle without relatedContext", () => {
    const bundle = {
      issue: validIssue(),
      repo: validRepoConfig(),
      constraints: validConstraints(),
      definitionOfDone: ["All tests pass"],
    };
    expect(() => TaskBundleSchema.parse(bundle)).not.toThrow();
  });

  it("accepts a task bundle including relatedContext", () => {
    const bundle = {
      issue: validIssue(),
      repo: validRepoConfig(),
      constraints: validConstraints(),
      definitionOfDone: [],
      relatedContext: { parent: validRelatedIssue(), blockers: [] },
    };
    const parsed = TaskBundleSchema.parse(bundle);
    expect(parsed.relatedContext?.parent?.id).toBe("LIN-2");
  });

  it("rejects a task bundle with an invalid nested issue", () => {
    const bundle = {
      issue: { ...validIssue(), priority: 10 },
      repo: validRepoConfig(),
      constraints: validConstraints(),
      definitionOfDone: [],
    };
    expect(() => TaskBundleSchema.parse(bundle)).toThrow();
  });

  it("rejects a task bundle missing required top-level fields", () => {
    expect(() => TaskBundleSchema.parse({ issue: validIssue() })).toThrow();
  });
});
