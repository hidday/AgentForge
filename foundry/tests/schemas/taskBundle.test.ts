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
    description: "Something is broken",
    labels: ["bug"],
    priority: 2,
  };
}

function validRepo() {
  return {
    name: "acme/repo",
    defaultBranch: "main",
    workingBranch: "lin-1-fix-bug",
    repoPath: "/workspace/repo",
    allowedPaths: ["src/"],
    protectedPaths: [".github/"],
  };
}

function validConstraints() {
  return {
    requiredChecks: ["lint", "test"],
    maxFilesChanged: 20,
    maxDiffLines: 1000,
    forbiddenPatterns: ["console\\.log"],
    mustNotTouch: ["prisma/migrations/"],
  };
}

function validRelatedIssue() {
  return {
    id: "LIN-2",
    title: "Parent issue",
    description: "Parent context",
    state: "In Progress",
    labels: [],
    priority: 1,
  };
}

describe("IssueSchema", () => {
  it("parses a minimal valid issue without optional fields", () => {
    const result = IssueSchema.parse(validIssue());
    expect(result.project).toBeUndefined();
    expect(result.cycle).toBeUndefined();
  });

  it("parses a full issue including optional project/cycle", () => {
    const result = IssueSchema.parse({ ...validIssue(), project: "Platform", cycle: "Sprint 1" });
    expect(result.project).toBe("Platform");
    expect(result.cycle).toBe("Sprint 1");
  });

  it.each([0, 4])("accepts the priority boundary value %i", (priority) => {
    expect(() => IssueSchema.parse({ ...validIssue(), priority })).not.toThrow();
  });

  it.each([-1, 5])("rejects a priority outside [0,4]: %i", (priority) => {
    expect(IssueSchema.safeParse({ ...validIssue(), priority }).success).toBe(false);
  });

  it("rejects a non-integer priority", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), priority: 1.5 }).success).toBe(false);
  });

  it("fails when a required field is missing", () => {
    const { title: _title, ...withoutTitle } = validIssue();
    expect(IssueSchema.safeParse(withoutTitle).success).toBe(false);
  });

  it("fails when labels is not an array of strings", () => {
    expect(IssueSchema.safeParse({ ...validIssue(), labels: "bug" }).success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("parses a valid repo config", () => {
    expect(RepoConfigSchema.parse(validRepo())).toEqual(validRepo());
  });

  it("fails when allowedPaths is missing", () => {
    const { allowedPaths: _allowedPaths, ...rest } = validRepo();
    expect(RepoConfigSchema.safeParse(rest).success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("parses valid constraints", () => {
    expect(ConstraintsSchema.parse(validConstraints())).toEqual(validConstraints());
  });

  it.each([0, -1, 1.5])("rejects a non-positive-integer maxFilesChanged: %s", (value) => {
    expect(ConstraintsSchema.safeParse({ ...validConstraints(), maxFilesChanged: value }).success).toBe(
      false,
    );
  });

  it.each([0, -1, 1.5])("rejects a non-positive-integer maxDiffLines: %s", (value) => {
    expect(ConstraintsSchema.safeParse({ ...validConstraints(), maxDiffLines: value }).success).toBe(
      false,
    );
  });
});

describe("RelatedIssueSchema / RelatedContextSchema", () => {
  it("parses a related issue without identifier/url", () => {
    const result = RelatedIssueSchema.parse(validRelatedIssue());
    expect(result.identifier).toBeUndefined();
    expect(result.url).toBeUndefined();
  });

  it("parses a related issue with identifier and url", () => {
    const result = RelatedIssueSchema.parse({
      ...validRelatedIssue(),
      identifier: "LIN-2",
      url: "https://linear.app/x/issue/LIN-2",
    });
    expect(result.identifier).toBe("LIN-2");
  });

  it("parses related context with no parent and empty blockers", () => {
    const result = RelatedContextSchema.parse({ blockers: [] });
    expect(result.parent).toBeUndefined();
    expect(result.blockers).toEqual([]);
  });

  it("parses related context with a parent and blockers", () => {
    const result = RelatedContextSchema.parse({
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue()],
    });
    expect(result.parent?.id).toBe("LIN-2");
    expect(result.blockers).toHaveLength(1);
  });

  it("fails when blockers is missing", () => {
    expect(RelatedContextSchema.safeParse({}).success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  function validBundle() {
    return {
      issue: validIssue(),
      repo: validRepo(),
      constraints: validConstraints(),
      definitionOfDone: ["All tests pass"],
    };
  }

  it("parses a full valid task bundle without relatedContext", () => {
    const result = TaskBundleSchema.parse(validBundle());
    expect(result.relatedContext).toBeUndefined();
    expect(result.issue.id).toBe("LIN-1");
    expect(result.definitionOfDone).toEqual(["All tests pass"]);
  });

  it("parses a task bundle including relatedContext", () => {
    const result = TaskBundleSchema.parse({
      ...validBundle(),
      relatedContext: { parent: validRelatedIssue(), blockers: [] },
    });
    expect(result.relatedContext?.parent?.id).toBe("LIN-2");
  });

  it("fails when a nested required object (constraints) is missing", () => {
    const { constraints: _constraints, ...rest } = validBundle();
    const result = TaskBundleSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("fails when issue.priority is out of bounds, surfacing a nested path in the error", () => {
    const result = TaskBundleSchema.safeParse({
      ...validBundle(),
      issue: { ...validIssue(), priority: 9 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "issue.priority")).toBe(true);
    }
  });
});
