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
    title: "Add validation middleware",
    description: "Add Zod-based validation to all endpoints.",
    labels: ["backend", "validation"],
    priority: 2,
    project: "API",
    cycle: "Cycle 12",
  };
}

function validRepoConfig() {
  return {
    name: "agentforge",
    defaultBranch: "main",
    workingBranch: "feature/validation",
    repoPath: "/workspace/agentforge",
    allowedPaths: ["src/**"],
    protectedPaths: ["src/generated/**"],
  };
}

function validConstraints() {
  return {
    requiredChecks: ["lint", "test"],
    maxFilesChanged: 20,
    maxDiffLines: 500,
    forbiddenPatterns: ["eval("],
    mustNotTouch: ["src/generated/**"],
  };
}

function validRelatedIssue() {
  return {
    id: "parent-1",
    identifier: "ENG-100",
    title: "Parent epic",
    description: "The umbrella epic.",
    state: "in_progress",
    labels: ["epic"],
    priority: 1,
    url: "https://linear.app/team/issue/ENG-100",
  };
}

function validTaskBundle() {
  return {
    issue: validIssue(),
    repo: validRepoConfig(),
    constraints: validConstraints(),
    definitionOfDone: ["All endpoints validated", "Tests pass"],
    relatedContext: {
      parent: validRelatedIssue(),
      blockers: [validRelatedIssue()],
    },
  };
}

describe("TaskBundleSchema", () => {
  it("parses a fully-populated valid task bundle with the expected shape", () => {
    const input = validTaskBundle();
    const result = TaskBundleSchema.parse(input);

    expect(result.issue.id).toBe("issue-1");
    expect(result.issue.priority).toBe(2);
    expect(result.repo.name).toBe("agentforge");
    expect(result.constraints.maxFilesChanged).toBe(20);
    expect(result.definitionOfDone).toEqual(["All endpoints validated", "Tests pass"]);
    expect(result.relatedContext?.parent?.id).toBe("parent-1");
    expect(result.relatedContext?.blockers).toHaveLength(1);
  });

  it("parses successfully when the optional relatedContext is omitted", () => {
    const input = validTaskBundle();
    delete (input as { relatedContext?: unknown }).relatedContext;

    const result = TaskBundleSchema.parse(input);
    expect(result.relatedContext).toBeUndefined();
  });

  it("parses successfully when optional issue fields (project, cycle) are omitted", () => {
    const input = validTaskBundle();
    delete (input.issue as { project?: string }).project;
    delete (input.issue as { cycle?: string }).cycle;

    const result = TaskBundleSchema.parse(input);
    expect(result.issue.project).toBeUndefined();
    expect(result.issue.cycle).toBeUndefined();
  });

  it("fails when a top-level required field (repo) is missing", () => {
    const input = validTaskBundle();
    delete (input as { repo?: unknown }).repo;

    const result = TaskBundleSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "repo")).toBe(true);
    }
  });

  it("fails when issue.priority is the wrong type", () => {
    const input = validTaskBundle();
    (input.issue as unknown as { priority: unknown }).priority = "high";

    const result = TaskBundleSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.join(".") === "issue.priority"),
      ).toBe(true);
    }
  });

  it("fails when issue.priority is above the allowed max (4)", () => {
    const input = validTaskBundle();
    input.issue.priority = 5;

    const result = TaskBundleSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "issue.priority");
      expect(issue).toBeDefined();
      expect(issue?.code).toBe("too_big");
    }
  });

  it("fails when issue.priority is below the allowed min (0)", () => {
    const input = validTaskBundle();
    input.issue.priority = -1;

    const result = TaskBundleSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "issue.priority");
      expect(issue).toBeDefined();
      expect(issue?.code).toBe("too_small");
    }
  });

  it("fails when issue.priority is non-integer", () => {
    const input = validTaskBundle();
    input.issue.priority = 2.5;

    const result = TaskBundleSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "issue.priority");
      expect(issue).toBeDefined();
      expect(issue?.code).toBe("invalid_type");
    }
  });

  it("fails when definitionOfDone contains a non-string element", () => {
    const input = validTaskBundle();
    (input as unknown as { definitionOfDone: unknown[] }).definitionOfDone = [
      "ok",
      42,
    ];

    const result = TaskBundleSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.join(".") === "definitionOfDone.1"),
      ).toBe(true);
    }
  });

  it("fails when constraints.maxFilesChanged is not positive", () => {
    const input = validTaskBundle();
    input.constraints.maxFilesChanged = 0;

    const result = TaskBundleSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.join(".") === "constraints.maxFilesChanged"),
      ).toBe(true);
    }
  });

  it("fails when relatedContext.blockers is missing (required array, not optional)", () => {
    const input = validTaskBundle();
    delete (input.relatedContext as { blockers?: unknown }).blockers;

    const result = TaskBundleSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) => issue.path.join(".") === "relatedContext.blockers",
        ),
      ).toBe(true);
    }
  });

  it("fails when repo is missing a required field (repoPath)", () => {
    const input = validTaskBundle();
    delete (input.repo as { repoPath?: string }).repoPath;

    const result = TaskBundleSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "repo.repoPath")).toBe(
        true,
      );
    }
  });
});

describe("IssueSchema", () => {
  it("accepts a minimal valid issue without optional fields", () => {
    const result = IssueSchema.safeParse({
      id: "i1",
      title: "t",
      description: "d",
      labels: [],
      priority: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing title", () => {
    const result = IssueSchema.safeParse({
      id: "i1",
      description: "d",
      labels: [],
      priority: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a valid repo config", () => {
    expect(RepoConfigSchema.safeParse(validRepoConfig()).success).toBe(true);
  });

  it("rejects a non-array allowedPaths", () => {
    const config = { ...validRepoConfig(), allowedPaths: "src/**" };
    expect(RepoConfigSchema.safeParse(config).success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  it("accepts valid constraints", () => {
    expect(ConstraintsSchema.safeParse(validConstraints()).success).toBe(true);
  });

  it("rejects a negative maxDiffLines", () => {
    const constraints = { ...validConstraints(), maxDiffLines: -5 };
    expect(ConstraintsSchema.safeParse(constraints).success).toBe(false);
  });
});

describe("RelatedIssueSchema", () => {
  it("accepts a related issue without the optional identifier/url", () => {
    const issue = validRelatedIssue();
    delete (issue as { identifier?: string }).identifier;
    delete (issue as { url?: string }).url;
    expect(RelatedIssueSchema.safeParse(issue).success).toBe(true);
  });

  it("rejects a related issue missing state", () => {
    const issue = validRelatedIssue();
    delete (issue as { state?: string }).state;
    expect(RelatedIssueSchema.safeParse(issue).success).toBe(false);
  });
});

describe("RelatedContextSchema", () => {
  it("accepts an empty blockers array with no parent", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [] });
    expect(result.success).toBe(true);
  });

  it("rejects when blockers is absent", () => {
    const result = RelatedContextSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
