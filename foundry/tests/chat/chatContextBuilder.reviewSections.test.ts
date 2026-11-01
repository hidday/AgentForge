import { describe, it, expect } from "vitest";
import { buildChatSystemPrompt } from "../../src/chat/chatContextBuilder.js";
import type { Run, Artifact } from "../../src/domain/types.js";

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
  };
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

describe("buildChatSystemPrompt - PlanReview section", () => {
  it("renders the Plan Review Findings section with summary and formatted findings", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "Plan looks mostly solid.",
        findings: [
          { id: "f1", severity: "blocker", title: "Missing rollback", details: "Add a rollback step." },
        ],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("**Summary:** Plan looks mostly solid.");
    expect(result).toContain("  - **[blocker] Missing rollback** (f1): Add a rollback step.");
  });

  it("omits the Plan Review Findings section entirely when summary and findings are both empty", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { summary: "", findings: [] },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).not.toContain("## Plan Review Findings");
  });

  it("uses the latest PlanReview artifact by version when several are present", () => {
    const older = makeArtifact({ type: "PlanReview", version: 1, payloadJson: { summary: "Old review" } });
    const newer = makeArtifact({ type: "PlanReview", version: 2, payloadJson: { summary: "New review" } });

    const result = buildChatSystemPrompt(makeRun(), [older, newer]);

    expect(result).toContain("**Summary:** New review");
    expect(result).not.toContain("Old review");
  });
});

describe("buildChatSystemPrompt - Review (code review) section", () => {
  it("renders the Code Review Findings section with summary and formatted findings", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "Diff is clean overall.",
        findings: [
          { id: "f2", severity: "nit", title: "Naming nit", details: "Prefer camelCase." },
        ],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("**Summary:** Diff is clean overall.");
    expect(result).toContain("  - **[nit] Naming nit** (f2): Prefer camelCase.");
  });

  it("omits the Code Review Findings section when summary and findings are both empty", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { summary: "", findings: [] },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).not.toContain("## Code Review Findings");
  });

  it("renders a summary-only Review section when findings is absent", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { summary: "Looks fine, no findings to report." },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("**Summary:** Looks fine, no findings to report.");
  });
});
