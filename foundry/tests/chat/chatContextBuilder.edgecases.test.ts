import { describe, it, expect } from "vitest";
import { buildChatSystemPrompt } from "../../src/chat/chatContextBuilder.js";
import type { Run } from "../../src/domain/types.js";
import type { Artifact } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: "Implement the feature",
    linearIssueTitle: "Feature XYZ",
    linearIssueUrl: "https://linear.app/test/issue/ENG-42",
    repo: "test/repo",
    branchName: "feature/xyz",
    prNumber: 99,
    state: "Implementing",
    planVersion: 2,
    approvedPlanVersion: 2,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/workspace/repo",
    latestArtifactVersion: 5,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
    ...overrides,
  } as Run;
}

function makeArtifact(overrides: Partial<Artifact> & { type: string }): Artifact {
  return {
    id: `artifact-${Math.random()}`,
    runId: "run-1",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: new Date("2024-01-01"),
    ...overrides,
  } as Artifact;
}

describe("buildChatSystemPrompt — PlanReview findings section", () => {
  it("includes the '## Plan Review Findings' section with summary and each finding when a PlanReview artifact is present", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "Mostly solid, one concern about scope.",
        findings: [
          {
            id: "pr-f1",
            severity: "important",
            title: "Missing rollback step",
            details: "The plan does not describe how to roll back the migration.",
          },
        ],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("Mostly solid, one concern about scope.");
    expect(result).toContain("**[important] Missing rollback step** (pr-f1)");
    expect(result).toContain("The plan does not describe how to roll back the migration.");
  });

  it("omits the '## Plan Review Findings' section entirely when no PlanReview artifact is present", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("omits the section when the PlanReview artifact has an empty summary and no findings", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { summary: "", findings: [] },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("renders only the summary line when findings is empty but summary is present", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { summary: "Looks good overall.", findings: [] },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("**Summary:** Looks good overall.");
  });
});

describe("buildChatSystemPrompt — Code Review findings section", () => {
  it("includes the '## Code Review Findings' section with summary and each finding when a Review artifact is present", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "One blocker found.",
        findings: [
          {
            id: "rv-f1",
            severity: "blocker",
            title: "Null pointer dereference",
            details: "foo.bar is accessed without a null check.",
          },
        ],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("One blocker found.");
    expect(result).toContain("**[blocker] Null pointer dereference** (rv-f1)");
    expect(result).toContain("foo.bar is accessed without a null check.");
  });

  it("omits the '## Code Review Findings' section entirely when no Review artifact is present", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Code Review Findings");
  });

  it("omits the section when the Review artifact has an empty summary and no findings", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { summary: "", findings: [] },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Code Review Findings");
  });

  it("renders multiple findings, each on its own bullet line", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "Two issues found.",
        findings: [
          { id: "f1", severity: "blocker", title: "Issue one", details: "Details one" },
          { id: "f2", severity: "nit", title: "Issue two", details: "Details two" },
        ],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**[blocker] Issue one** (f1): Details one");
    expect(result).toContain("**[nit] Issue two** (f2): Details two");
  });
});
