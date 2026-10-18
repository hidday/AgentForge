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

describe("buildChatSystemPrompt - additional branch coverage", () => {
  it("includes rendered open questions when the Plan artifact has non-empty openQuestions", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Plan with questions",
        openQuestions: [
          { id: "q1", question: "Which DB?" },
          "A plain-string open question",
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);

    expect(result).toContain("## Current Plan");
    expect(result).toContain("**Open Questions:**");
    expect(result).toContain("Which DB?");
    expect(result).toContain("A plain-string open question");
  });

  it("omits the Open Questions block when the Plan artifact's openQuestions array is empty", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { summary: "Plan with no questions", openQuestions: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);

    expect(result).not.toContain("**Open Questions:**");
  });

  it("includes the Plan Review Findings section with summary and formatted findings", () => {
    const planReviewArtifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "Plan looks mostly solid.",
        findings: [
          { id: "f1", severity: "high", title: "Missing rollback plan", details: "No rollback steps." },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planReviewArtifact]);

    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("**Summary:** Plan looks mostly solid.");
    expect(result).toContain("**[high] Missing rollback plan** (f1): No rollback steps.");
  });

  it("omits the Plan Review Findings section when summary and findings are both absent", () => {
    const planReviewArtifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {},
    });
    const result = buildChatSystemPrompt(makeRun(), [planReviewArtifact]);

    expect(result).not.toContain("## Plan Review Findings");
  });

  it("includes the Code Review Findings section with summary and formatted findings", () => {
    const reviewArtifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "A few nits, nothing blocking.",
        findings: [
          { id: "r1", severity: "low", title: "Unused import", details: "Remove unused import in foo.ts" },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [reviewArtifact]);

    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("**Summary:** A few nits, nothing blocking.");
    expect(result).toContain("**[low] Unused import** (r1): Remove unused import in foo.ts");
  });

  it("omits the Code Review Findings section when summary and findings are both absent", () => {
    const reviewArtifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {},
    });
    const result = buildChatSystemPrompt(makeRun(), [reviewArtifact]);

    expect(result).not.toContain("## Code Review Findings");
  });

  it("falls back to empty-string placeholders for missing finding fields in Code Review Findings", () => {
    const reviewArtifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { findings: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [reviewArtifact]);

    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("  - **[] ** ():");
  });

  it("renders '?' for a check whose status is missing, and omits the details suffix when details is absent", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        checks: {
          lint: {},
          typecheck: { status: "pass" },
          tests: { status: "fail", details: "1 flake" },
        },
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).toContain("**Lint:** ?");
    expect(result).toContain("**Typecheck:** pass");
    expect(result).not.toContain("**Typecheck:** pass —");
    expect(result).toContain("**Tests:** fail — 1 flake");
  });

  it("JSON-stringifies non-string entries in filesChanged and notes", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        filesChanged: [{ path: "src/foo.ts", renamed: true }],
        notes: [{ kind: "warning", text: "watch out" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).toContain('{"path":"src/foo.ts","renamed":true}');
    expect(result).toContain('{"kind":"warning","text":"watch out"}');
  });

  it("falls back to execReportArtifact.version when payload.executionVersion is absent", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 7,
      payloadJson: {
        score: 0.5,
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).toContain("## Execution Report (v7)");
  });

  it("falls back to '?' and empty-string placeholders for missing RejectionContext fields", () => {
    const artifact = makeArtifact({
      type: "RejectionContext",
      version: 1,
      payloadJson: {},
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).toContain("## Rejection Context(s)");
    expect(result).toContain("  - **Plan v?** (, ):");
  });
});

describe("findLatest - reduce over multiple artifacts in descending version order", () => {
  it("keeps the earlier (higher-version) artifact when later ones in the array have a lower version", () => {
    const planV2 = makeArtifact({
      type: "Plan",
      version: 2,
      payloadJson: { summary: "Newer summary, appears first" },
    });
    const planV1 = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { summary: "Older summary, appears second" },
    });
    const result = buildChatSystemPrompt(makeRun(), [planV2, planV1]);

    expect(result).toContain("Newer summary, appears first");
    expect(result).not.toContain("Older summary, appears second");
  });
});
