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

describe("buildChatSystemPrompt — plan review findings", () => {
  it("includes the PlanReview summary and findings when a PlanReview artifact is present", () => {
    const prompt = buildChatSystemPrompt(makeRun(), [
      makeArtifact({
        type: "PlanReview",
        payloadJson: {
          summary: "Mostly solid, one concern",
          findings: [
            { id: "f1", severity: "important", title: "Missing test", details: "Add a unit test." },
          ],
        },
      }),
    ]);

    expect(prompt).toContain("## Plan Review Findings");
    expect(prompt).toContain("**Summary:** Mostly solid, one concern");
    expect(prompt).toContain("- **[important] Missing test** (f1): Add a unit test.");
  });

  it("omits the section when the PlanReview payload has no summary and no findings", () => {
    const prompt = buildChatSystemPrompt(makeRun(), [
      makeArtifact({ type: "PlanReview", payloadJson: {} }),
    ]);

    expect(prompt).not.toContain("## Plan Review Findings");
  });

  it("defaults missing finding fields to empty strings", () => {
    const prompt = buildChatSystemPrompt(makeRun(), [
      makeArtifact({
        type: "PlanReview",
        payloadJson: { findings: [{}] },
      }),
    ]);

    expect(prompt).toContain("- **[] ** ():");
  });
});

describe("buildChatSystemPrompt — code review findings", () => {
  it("includes the Review summary and findings when a Review artifact is present", () => {
    const prompt = buildChatSystemPrompt(makeRun(), [
      makeArtifact({
        type: "Review",
        payloadJson: {
          summary: "Looks good overall",
          findings: [
            { id: "r1", severity: "blocker", title: "SQL injection risk", details: "Use parameterized queries." },
          ],
        },
      }),
    ]);

    expect(prompt).toContain("## Code Review Findings");
    expect(prompt).toContain("**Summary:** Looks good overall");
    expect(prompt).toContain("- **[blocker] SQL injection risk** (r1): Use parameterized queries.");
  });

  it("omits the section when the Review payload has no summary and no findings", () => {
    const prompt = buildChatSystemPrompt(makeRun(), [
      makeArtifact({ type: "Review", payloadJson: {} }),
    ]);

    expect(prompt).not.toContain("## Code Review Findings");
  });
});

describe("buildChatSystemPrompt — plan open questions", () => {
  it("renders open questions in the Current Plan section", () => {
    const prompt = buildChatSystemPrompt(makeRun(), [
      makeArtifact({
        type: "Plan",
        payloadJson: {
          summary: "A plan",
          openQuestions: [{ id: "q1", question: "What auth method?" }],
        },
      }),
    ]);

    expect(prompt).toContain("**Open Questions:**");
    expect(prompt).toContain(JSON.stringify({ id: "q1", question: "What auth method?" }));
  });

  it("omits the Open Questions line when there are none", () => {
    const prompt = buildChatSystemPrompt(makeRun(), [
      makeArtifact({ type: "Plan", payloadJson: { summary: "A plan", openQuestions: [] } }),
    ]);

    expect(prompt).not.toContain("**Open Questions:**");
  });
});

describe("buildChatSystemPrompt — execution report boolean/optional fields", () => {
  it("renders 'PR Draft Created: yes' when prDraftCreated is true", () => {
    const prompt = buildChatSystemPrompt(makeRun(), [
      makeArtifact({ type: "ExecutionReport", payloadJson: { score: 0.5, prDraftCreated: true } }),
    ]);
    expect(prompt).toContain("**PR Draft Created:** yes");
  });

  it("renders 'PR Draft Created: no' when prDraftCreated is false", () => {
    const prompt = buildChatSystemPrompt(makeRun(), [
      makeArtifact({ type: "ExecutionReport", payloadJson: { score: 0.5, prDraftCreated: false } }),
    ]);
    expect(prompt).toContain("**PR Draft Created:** no");
  });

  it("omits the PR Draft Created line when the field is absent", () => {
    const prompt = buildChatSystemPrompt(makeRun(), [
      makeArtifact({ type: "ExecutionReport", payloadJson: { score: 0.5 } }),
    ]);
    expect(prompt).not.toContain("PR Draft Created");
  });

  it("falls back to the artifact's own version when executionVersion is absent", () => {
    const prompt = buildChatSystemPrompt(makeRun(), [
      makeArtifact({ type: "ExecutionReport", version: 4, payloadJson: { score: 0.5 } }),
    ]);
    expect(prompt).toContain("## Execution Report (v4)");
  });

  it("renders notes and files changed with non-string entries JSON-stringified", () => {
    const prompt = buildChatSystemPrompt(makeRun(), [
      makeArtifact({
        type: "ExecutionReport",
        payloadJson: {
          score: 0.5,
          filesChanged: ["src/a.ts", { path: "src/b.ts" }],
          notes: ["a plain note", { warning: "watch out" }],
        },
      }),
    ]);
    expect(prompt).toContain("`src/a.ts`");
    expect(prompt).toContain(`\`${JSON.stringify({ path: "src/b.ts" })}\``);
    expect(prompt).toContain("a plain note");
    expect(prompt).toContain(JSON.stringify({ warning: "watch out" }));
  });

  it("renders unknown check status as '?' when a check object field is missing", () => {
    const prompt = buildChatSystemPrompt(makeRun(), [
      makeArtifact({ type: "ExecutionReport", payloadJson: { score: 0.5, checks: {} } }),
    ]);
    expect(prompt).toContain("**Lint:** ?");
  });
});

describe("buildChatSystemPrompt — no linear issue metadata", () => {
  it("omits the Linear Issue section entirely when title, identifier, and description are all absent", () => {
    const prompt = buildChatSystemPrompt(
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: null, linearIssueDescription: null }),
      [],
    );
    expect(prompt).not.toContain("## Linear Issue");
  });
});
