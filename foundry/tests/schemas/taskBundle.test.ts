import { describe, it, expect } from "vitest";
import {
  IssueSchema,
  RepoConfigSchema,
  ConstraintsSchema,
  RelatedIssueSchema,
  RelatedContextSchema,
  TaskBundleSchema,
} from "../../src/schemas/taskBundle.js";

const validIssue = {
  id: "ISS-1",
  title: "Fix bug",
  description: "A bug needs fixing",
  labels: ["bug"],
  priority: 2,
};

const validRepo = {
  name: "AgentForge",
  defaultBranch: "main",
  workingBranch: "feature/x",
  repoPath: "/repos/agentforge",
  allowedPaths: ["src/"],
  protectedPaths: ["prisma/"],
};

const validConstraints = {
  requiredChecks: ["lint", "test"],
  maxFilesChanged: 10,
  maxDiffLines: 500,
  forbiddenPatterns: ["**/*.env"],
  mustNotTouch: ["prisma/migrations/**"],
};

const validRelatedIssue = {
  id: "ISS-2",
  title: "Blocker issue",
  description: "Blocks ISS-1",
  state: "open",
  labels: [],
  priority: 1,
};

describe("IssueSchema", () => {
  it("accepts a fully valid issue including optional fields", () => {
    const result = IssueSchema.parse({ ...validIssue, project: "Core", cycle: "Cycle 3" });
    expect(result.project).toBe("Core");
    expect(result.cycle).toBe("Cycle 3");
  });

  it("accepts an issue without the optional project/cycle fields", () => {
    const result = IssueSchema.parse(validIssue);
    expect(result.project).toBeUndefined();
    expect(result.cycle).toBeUndefined();
  });

  it("accepts priority boundary values 0 and 4", () => {
    expect(IssueSchema.parse({ ...validIssue, priority: 0 }).priority).toBe(0);
    expect(IssueSchema.parse({ ...validIssue, priority: 4 }).priority).toBe(4);
  });

  it("rejects priority below the minimum boundary", () => {
    const result = IssueSchema.safeParse({ ...validIssue, priority: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects priority above the maximum boundary", () => {
    const result = IssueSchema.safeParse({ ...validIssue, priority: 5 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer priority", () => {
    const result = IssueSchema.safeParse({ ...validIssue, priority: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { title, ...rest } = validIssue;
    const result = IssueSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("title"))).toBe(true);
    }
  });

  it("rejects labels that are not an array of strings", () => {
    const result = IssueSchema.safeParse({ ...validIssue, labels: "bug" });
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a valid repo config", () => {
    expect(RepoConfigSchema.parse(validRepo)).toEqual(validRepo);
  });

  it("rejects a missing required field", () => {
    const { repoPath, ...rest } = validRepo;
    expect(RepoConfigSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects non-string allowedPaths entries", () => {
    const result = RepoConfigSchema.safeParse({ ...validRepo, allowedPaths: [1, 2] });
    expect(result.success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("accepts valid constraints", () => {
    expect(ConstraintsSchema.parse(validConstraints)).toEqual(validConstraints);
  });

  it("rejects a zero maxFilesChanged (must be positive)", () => {
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints, maxFilesChanged: 0 }).success,
    ).toBe(false);
  });

  it("rejects a negative maxDiffLines", () => {
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints, maxDiffLines: -1 }).success,
    ).toBe(false);
  });

  it("rejects a non-integer maxFilesChanged", () => {
    expect(
      ConstraintsSchema.safeParse({ ...validConstraints, maxFilesChanged: 2.5 }).success,
    ).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a valid related issue with optional fields", () => {
    const result = RelatedIssueSchema.parse({
      ...validRelatedIssue,
      identifier: "ENG-2",
      url: "https://example.com/ENG-2",
    });
    expect(result.identifier).toBe("ENG-2");
    expect(result.url).toBe("https://example.com/ENG-2");
  });

  it("accepts a related issue without optional fields", () => {
    const result = RelatedIssueSchema.parse(validRelatedIssue);
    expect(result.identifier).toBeUndefined();
    expect(result.url).toBeUndefined();
  });

  it("rejects priority outside the 0-4 range", () => {
    expect(
      RelatedIssueSchema.safeParse({ ...validRelatedIssue, priority: 9 }).success,
    ).toBe(false);
  });

  it("rejects a missing required state field", () => {
    const { state, ...rest } = validRelatedIssue;
    expect(RelatedIssueSchema.safeParse(rest).success).toBe(false);
  });
});

describe("RelatedContextSchema", () => {
  it("accepts an empty blockers array with no parent", () => {
    const result = RelatedContextSchema.parse({ blockers: [] });
    expect(result.parent).toBeUndefined();
    expect(result.blockers).toEqual([]);
  });

  it("accepts a parent and multiple blockers", () => {
    const result = RelatedContextSchema.parse({
      parent: validRelatedIssue,
      blockers: [validRelatedIssue, { ...validRelatedIssue, id: "ISS-3" }],
    });
    expect(result.blockers).toHaveLength(2);
    expect(result.parent?.id).toBe("ISS-2");
  });

  it("rejects a missing blockers array", () => {
    expect(RelatedContextSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an invalid parent shape", () => {
    expect(
      RelatedContextSchema.safeParse({ parent: { id: "x" }, blockers: [] }).success,
    ).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  const validBundle = {
    issue: validIssue,
    repo: validRepo,
    constraints: validConstraints,
    definitionOfDone: ["All tests pass"],
  };

  it("accepts a minimal valid bundle without relatedContext", () => {
    const result = TaskBundleSchema.parse(validBundle);
    expect(result.relatedContext).toBeUndefined();
    expect(result.definitionOfDone).toEqual(["All tests pass"]);
  });

  it("accepts a full bundle including relatedContext", () => {
    const result = TaskBundleSchema.parse({
      ...validBundle,
      relatedContext: { blockers: [validRelatedIssue] },
    });
    expect(result.relatedContext?.blockers).toHaveLength(1);
  });

  it("rejects a bundle missing the issue field", () => {
    const { issue, ...rest } = validBundle;
    expect(TaskBundleSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a bundle with an invalid nested repo config", () => {
    const result = TaskBundleSchema.safeParse({
      ...validBundle,
      repo: { ...validRepo, allowedPaths: "not-an-array" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "repo.allowedPaths")).toBe(
        true,
      );
    }
  });

  it("rejects a bundle where definitionOfDone is not an array", () => {
    expect(
      TaskBundleSchema.safeParse({ ...validBundle, definitionOfDone: "done" }).success,
    ).toBe(false);
  });
});
