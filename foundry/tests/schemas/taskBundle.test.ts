import { describe, it, expect } from "vitest";
import {
  IssueSchema,
  RepoConfigSchema,
  ConstraintsSchema,
  RelatedIssueSchema,
  RelatedContextSchema,
  TaskBundleSchema,
} from "../../src/schemas/taskBundle.js";

describe("IssueSchema", () => {
  const validIssue = {
    id: "ISS-1",
    title: "Fix bug",
    description: "Something is broken",
    labels: ["bug"],
    priority: 2,
  };

  it("accepts a minimal valid issue without optional fields", () => {
    const result = IssueSchema.safeParse(validIssue);
    expect(result.success).toBe(true);
  });

  it("accepts optional project and cycle fields", () => {
    const result = IssueSchema.safeParse({ ...validIssue, project: "Core", cycle: "Sprint 1" });
    expect(result.success).toBe(true);
  });

  it("rejects a priority outside the 0-4 range", () => {
    const result = IssueSchema.safeParse({ ...validIssue, priority: 5 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer priority", () => {
    const result = IssueSchema.safeParse({ ...validIssue, priority: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { title: _title, ...withoutTitle } = validIssue;
    const result = IssueSchema.safeParse(withoutTitle);
    expect(result.success).toBe(false);
  });
});

describe("RepoConfigSchema", () => {
  it("accepts a well-formed repo config", () => {
    const result = RepoConfigSchema.safeParse({
      name: "agentforge",
      defaultBranch: "main",
      workingBranch: "feature/x",
      repoPath: "/repos/agentforge",
      allowedPaths: ["src/"],
      protectedPaths: ["src/secrets/"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-array allowedPaths", () => {
    const result = RepoConfigSchema.safeParse({
      name: "agentforge",
      defaultBranch: "main",
      workingBranch: "feature/x",
      repoPath: "/repos/agentforge",
      allowedPaths: "src/",
      protectedPaths: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("ConstraintsSchema", () => {
  const base = {
    requiredChecks: ["lint"],
    maxFilesChanged: 5,
    maxDiffLines: 200,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };

  it("accepts valid constraints", () => {
    expect(ConstraintsSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a zero or negative maxFilesChanged", () => {
    expect(ConstraintsSchema.safeParse({ ...base, maxFilesChanged: 0 }).success).toBe(false);
    expect(ConstraintsSchema.safeParse({ ...base, maxFilesChanged: -1 }).success).toBe(false);
  });

  it("rejects a zero or negative maxDiffLines", () => {
    expect(ConstraintsSchema.safeParse({ ...base, maxDiffLines: 0 }).success).toBe(false);
  });
});

describe("RelatedIssueSchema and RelatedContextSchema", () => {
  const relatedIssue = {
    id: "ISS-2",
    title: "Blocker",
    description: "Blocking issue",
    state: "open",
    labels: [],
    priority: 1,
  };

  it("accepts a related issue without the optional identifier/url", () => {
    expect(RelatedIssueSchema.safeParse(relatedIssue).success).toBe(true);
  });

  it("accepts a related context with a parent and blockers", () => {
    const result = RelatedContextSchema.safeParse({
      parent: { ...relatedIssue, identifier: "ISS-0", url: "https://example.com/ISS-0" },
      blockers: [relatedIssue],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a related context with no parent", () => {
    const result = RelatedContextSchema.safeParse({ blockers: [relatedIssue] });
    expect(result.success).toBe(true);
  });

  it("rejects a related context missing the required blockers array", () => {
    const result = RelatedContextSchema.safeParse({ parent: relatedIssue });
    expect(result.success).toBe(false);
  });
});

describe("TaskBundleSchema", () => {
  const issue = {
    id: "ISS-1",
    title: "Fix bug",
    description: "Something is broken",
    labels: ["bug"],
    priority: 2,
  };
  const repo = {
    name: "agentforge",
    defaultBranch: "main",
    workingBranch: "feature/x",
    repoPath: "/repos/agentforge",
    allowedPaths: ["src/"],
    protectedPaths: [],
  };
  const constraints = {
    requiredChecks: [],
    maxFilesChanged: 5,
    maxDiffLines: 200,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };

  it("accepts a full task bundle without the optional relatedContext", () => {
    const result = TaskBundleSchema.safeParse({
      issue,
      repo,
      constraints,
      definitionOfDone: ["Tests pass"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a full task bundle with relatedContext included", () => {
    const result = TaskBundleSchema.safeParse({
      issue,
      repo,
      constraints,
      definitionOfDone: [],
      relatedContext: { blockers: [] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a task bundle with a malformed nested issue", () => {
    const result = TaskBundleSchema.safeParse({
      issue: { ...issue, priority: 99 },
      repo,
      constraints,
      definitionOfDone: [],
    });
    expect(result.success).toBe(false);
  });
});
