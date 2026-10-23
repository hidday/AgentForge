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

describe("buildChatSystemPrompt — Plan Review Findings section", () => {
  it("renders summary and findings when a PlanReview artifact is present", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "Plan looks mostly solid.",
        findings: [
          {
            id: "pr1",
            severity: "important",
            title: "Missing migration step",
            details: "The plan does not account for the schema migration.",
          },
        ],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("**Summary:** Plan looks mostly solid.");
    expect(result).toContain("[important] Missing migration step");
    expect(result).toContain("(pr1)");
    expect(result).toContain("The plan does not account for the schema migration.");
  });

  it("omits the Plan Review Findings section when no PlanReview artifact is present", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("omits the section entirely when summary and findings are both empty/absent", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {},
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("renders summary-only PlanReview when findings array is empty", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { summary: "No blocking issues.", findings: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("**Summary:** No blocking issues.");
  });

  it("falls back to empty strings for missing finding fields", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        findings: [{}],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("  - **[] ** ()");
  });
});

describe("buildChatSystemPrompt — Code Review Findings section", () => {
  it("renders summary and findings when a Review artifact is present", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "Overall solid implementation.",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            title: "SQL injection risk",
            details: "User input is concatenated directly into the query.",
          },
        ],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("**Summary:** Overall solid implementation.");
    expect(result).toContain("[blocker] SQL injection risk");
    expect(result).toContain("(f1)");
    expect(result).toContain("User input is concatenated directly into the query.");
  });

  it("omits the Code Review Findings section when no Review artifact is present", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Code Review Findings");
  });

  it("omits the section entirely when summary and findings are both empty/absent", () => {
    const artifact = makeArtifact({ type: "Review", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Code Review Findings");
  });

  it("renders multiple findings each on their own line", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "Two issues found.",
        findings: [
          { id: "f1", severity: "blocker", title: "Issue A", details: "Details A" },
          { id: "f2", severity: "nit", title: "Issue B", details: "Details B" },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("[blocker] Issue A");
    expect(result).toContain("[nit] Issue B");
  });
});
