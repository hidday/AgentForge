import { describe, it, expect, vi } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Finding } from "../../src/schemas/review.js";
import type { ResolutionItem } from "../../src/schemas/remediation.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: 42,
    state: RunState.ReadyForHumanReview,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeGitHubClient() {
  return {
    verifyRepoAccess: vi.fn(),
    getDefaultBranch: vi.fn(),
    createBranch: vi.fn(),
    createDraftPR: vi.fn(),
    commentOnPR: vi.fn().mockResolvedValue(undefined),
    getPRDiff: vi.fn(),
    markPRReady: vi.fn().mockResolvedValue(undefined),
    listPRComments: vi.fn(),
    createPRReviewComment: vi.fn(),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
    submitPRReview: vi.fn().mockResolvedValue(undefined),
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "important",
    type: "bug",
    file: "src/a.ts",
    title: "Possible null deref",
    details: "Check for null before use",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "No issues" },
      typecheck: { status: "pass", details: "No issues" },
      tests: { status: "pass", details: "All green" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks solid",
    ...overrides,
  };
}

describe("GitHubSyncService.syncState", () => {
  it("does nothing when the run has no prNumber", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.syncState(makeRun({ prNumber: null }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when the run is ReadyForHumanReview", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42 }));

    expect(githubClient.markPRReady).toHaveBeenCalledWith("org/repo", 42);
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "org/repo",
      42,
      "All AI checks passed. Ready for human review.",
    );
  });

  it("does not mark ready for other states even with a prNumber", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Implementing, prNumber: 42 }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  it("posts inline comments and an APPROVE review when verdict is approved", async () => {
    const githubClient = makeGitHubClient();
    githubClient.createPRReviewComment.mockResolvedValue(555);
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const commentMap = await service.postReviewFindings(
      "org/repo",
      42,
      [makeFinding({ id: "f1", severity: "blocker", lineHint: 10 })],
      "approved",
    );

    expect(commentMap.get("f1")).toBe(555);
    expect(githubClient.createPRReviewComment).toHaveBeenCalledWith(
      "org/repo",
      42,
      expect.stringContaining("[BLOCKER]"),
      "src/a.ts",
      10,
    );
    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      42,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("requests changes when verdict is not approved", async () => {
    const githubClient = makeGitHubClient();
    githubClient.createPRReviewComment.mockResolvedValue(556);
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postReviewFindings(
      "org/repo",
      42,
      [makeFinding()],
      "changes_requested",
    );

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      42,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });

  it("omits findings from the map when createPRReviewComment returns 0", async () => {
    const githubClient = makeGitHubClient();
    githubClient.createPRReviewComment.mockResolvedValue(0);
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const commentMap = await service.postReviewFindings(
      "org/repo",
      42,
      [makeFinding({ id: "f1" })],
      "approved",
    );

    expect(commentMap.has("f1")).toBe(false);
  });

  it("handles an empty findings list", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const commentMap = await service.postReviewFindings("org/repo", 42, [], "approved");

    expect(commentMap.size).toBe(0);
    expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
    expect(githubClient.submitPRReview).toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  it("renders a collapsed file list and no notes section when below the threshold", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate(
      "org/repo",
      42,
      makeExecutionReport({ filesChanged: ["a.ts", "b.ts"], notes: [] }),
    );

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("Files changed (2)");
    expect(body).not.toContain("<details>");
    expect(body).not.toContain("### Notes");
  });

  it("renders a <details> collapsed section when files exceed the threshold", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const manyFiles = Array.from({ length: 9 }, (_, i) => `file${String(i)}.ts`);
    await service.postExecutionReportUpdate(
      "org/repo",
      42,
      makeExecutionReport({ filesChanged: manyFiles }),
    );

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });

  it("omits the files section entirely when there are no changed files", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate(
      "org/repo",
      42,
      makeExecutionReport({ filesChanged: [] }),
    );

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).not.toContain("Files changed");
  });

  it("renders a notes section when notes are present", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate(
      "org/repo",
      42,
      makeExecutionReport({ notes: ["Watch out for X"] }),
    );

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("### Notes");
    expect(body).toContain("Watch out for X");
  });

  it("renders the correct icon for pass, fail, and skip checks", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate(
      "org/repo",
      42,
      makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "fail", details: "broken" },
          tests: { status: "skip", details: "skipped" },
        },
      }),
    );

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain(":white_check_mark: **Lint**");
    expect(body).toContain(":x: **Typecheck**");
    expect(body).toContain(":heavy_minus_sign: **Tests**");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
    return {
      findingId: "f1",
      status: "accepted",
      action: "Fixed the null check",
      rationale: "Prevents crash",
      ...overrides,
    };
  }

  it("replies to the mapped GitHub comment and posts a summary", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "org/repo",
      42,
      [makeResolution({ findingId: "f1", status: "accepted" })],
      { f1: 555 },
    );

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "org/repo",
      42,
      555,
      expect.stringContaining(":white_check_mark:"),
    );
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "org/repo",
      42,
      expect.stringContaining("AI Remediation Summary"),
    );
  });

  it("skips replying when there is no GitHub comment id for a finding", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "org/repo",
      42,
      [makeResolution({ findingId: "f1" })],
      {},
    );

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).toHaveBeenCalled();
  });

  it("uses the correct icon for rejected and partially_addressed statuses", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "org/repo",
      42,
      [
        makeResolution({ findingId: "f1", status: "rejected" }),
        makeResolution({ findingId: "f2", status: "partially_addressed" }),
      ],
      { f1: 1, f2: 2 },
    );

    const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summary).toContain(":no_entry_sign:");
    expect(summary).toContain(":warning:");
  });

  it("falls back to a question-mark icon for an unrecognized status", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const weirdResolution = makeResolution({
      findingId: "f1",
      status: "unexpected" as unknown as ResolutionItem["status"],
    });

    await service.postRemediationResolutions("org/repo", 42, [weirdResolution], { f1: 1 });

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "org/repo",
      42,
      1,
      expect.stringContaining(":grey_question:"),
    );
    const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summary).toContain(":grey_question:");
  });
});
