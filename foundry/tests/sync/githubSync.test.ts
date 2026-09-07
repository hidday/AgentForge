import { describe, it, expect, vi } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Finding } from "../../src/schemas/review.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { ResolutionItem } from "../../src/schemas/remediation.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/repo",
    branchName: null,
    prNumber: 42,
    state: RunState.ReadyForHumanReview,
    planVersion: 1,
    approvedPlanVersion: 1,
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

function makeGithubClient() {
  return {
    verifyRepoAccess: vi.fn(),
    getDefaultBranch: vi.fn(),
    createBranch: vi.fn(),
    createDraftPR: vi.fn(),
    commentOnPR: vi.fn().mockResolvedValue(undefined),
    getPRDiff: vi.fn(),
    markPRReady: vi.fn().mockResolvedValue(undefined),
    listPRComments: vi.fn(),
    createPRReviewComment: vi.fn().mockResolvedValue(1000),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
    submitPRReview: vi.fn().mockResolvedValue(undefined),
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Did the work",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "pass", details: "12 passed" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "solid",
    ...overrides,
  };
}

describe("GitHubSyncService.syncState", () => {
  it("does nothing when the run has no PR number", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.syncState(makeRun({ prNumber: null }));

    expect(client.markPRReady).not.toHaveBeenCalled();
    expect(client.commentOnPR).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when state is ReadyForHumanReview", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42 }));

    expect(client.markPRReady).toHaveBeenCalledWith("acme/repo", 42);
    expect(client.commentOnPR).toHaveBeenCalledWith(
      "acme/repo",
      42,
      "All AI checks passed. Ready for human review.",
    );
  });

  it("does nothing when there is a PR but state is not ReadyForHumanReview", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Implementing, prNumber: 42 }));

    expect(client.markPRReady).not.toHaveBeenCalled();
    expect(client.commentOnPR).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  const findings: Finding[] = [
    { id: "f1", severity: "blocker", type: "bug", file: "a.ts", lineHint: 5, title: "Bug", details: "desc" },
    { id: "f2", severity: "nit", type: "style", file: "b.ts", title: "Style", details: "desc2" },
  ];

  it("posts an inline comment per finding and maps finding ids to comment ids", async () => {
    const client = makeGithubClient();
    client.createPRReviewComment
      .mockResolvedValueOnce(101)
      .mockResolvedValueOnce(102);
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    const map = await svc.postReviewFindings("acme/repo", 1, findings, "changes_requested");

    expect(client.createPRReviewComment).toHaveBeenCalledWith(
      "acme/repo",
      1,
      expect.stringContaining("[BLOCKER]"),
      "a.ts",
      5,
    );
    expect(map.get("f1")).toBe(101);
    expect(map.get("f2")).toBe(102);
  });

  it("skips mapping a finding when createPRReviewComment returns 0 (skipped)", async () => {
    const client = makeGithubClient();
    client.createPRReviewComment.mockResolvedValueOnce(0).mockResolvedValueOnce(202);
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    const map = await svc.postReviewFindings("acme/repo", 1, findings, "changes_requested");

    expect(map.has("f1")).toBe(false);
    expect(map.get("f2")).toBe(202);
  });

  it("submits an APPROVE review when verdict is approved", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postReviewFindings("acme/repo", 1, [], "approved");

    expect(client.submitPRReview).toHaveBeenCalledWith(
      "acme/repo",
      1,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("submits a REQUEST_CHANGES review for any non-approved verdict", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postReviewFindings("acme/repo", 1, [], "changes_requested");

    expect(client.submitPRReview).toHaveBeenCalledWith(
      "acme/repo",
      1,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  it("posts a comment with score, checks, and a flat files list under the collapse threshold", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postExecutionReportUpdate("acme/repo", 1, makeExecutionReport({ score: 0.87 }));

    const [, , body] = client.commentOnPR.mock.calls[0] as [string, number, string];
    expect(body).toContain("Score: 87%");
    expect(body).toContain(":white_check_mark: **Lint**");
    expect(body).toContain("### Files changed (1)");
    expect(body).not.toContain("<details>");
  });

  it("collapses the files list into a <details> block above the threshold", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);

    await svc.postExecutionReportUpdate(
      "acme/repo",
      1,
      makeExecutionReport({ filesChanged: manyFiles }),
    );

    const [, , body] = client.commentOnPR.mock.calls[0] as [string, number, string];
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });

  it("omits the files section entirely when no files changed", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postExecutionReportUpdate(
      "acme/repo",
      1,
      makeExecutionReport({ filesChanged: [] }),
    );

    const [, , body] = client.commentOnPR.mock.calls[0] as [string, number, string];
    expect(body).not.toContain("Files changed");
  });

  it("includes a Notes section only when notes are present", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postExecutionReportUpdate(
      "acme/repo",
      1,
      makeExecutionReport({ notes: ["Added a dependency"] }),
    );

    const [, , body] = client.commentOnPR.mock.calls[0] as [string, number, string];
    expect(body).toContain("### Notes");
    expect(body).toContain("Added a dependency");
  });

  it("renders fail and skip check icons distinctly", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postExecutionReportUpdate(
      "acme/repo",
      1,
      makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "2 errors" },
          typecheck: { status: "skip", details: "not run" },
          tests: { status: "pass", details: "ok" },
        },
      }),
    );

    const [, , body] = client.commentOnPR.mock.calls[0] as [string, number, string];
    expect(body).toContain(":x: **Lint**");
    expect(body).toContain(":heavy_minus_sign: **Typecheck**");
    expect(body).toContain(":white_check_mark: **Tests**");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  const resolutions: ResolutionItem[] = [
    { findingId: "f1", status: "accepted", action: "Fixed it", rationale: "Was a real bug" },
    { findingId: "f2", status: "rejected", action: "No change", rationale: "Out of scope" },
    { findingId: "f3", status: "partially_addressed", action: "Partial fix", rationale: "Time boxed" },
  ];

  it("replies to each mapped comment and posts a summary table", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postRemediationResolutions("acme/repo", 1, resolutions, { f1: 500, f2: 501 });

    expect(client.replyToReviewComment).toHaveBeenCalledTimes(2);
    expect(client.replyToReviewComment).toHaveBeenCalledWith(
      "acme/repo",
      1,
      500,
      expect.stringContaining("accepted"),
    );
    const [, , summaryBody] = client.commentOnPR.mock.calls[0] as [string, number, string];
    expect(summaryBody).toContain("## AI Remediation Summary");
    expect(summaryBody).toContain("f3");
  });

  it("skips replying to a finding with no mapped GitHub comment id", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postRemediationResolutions("acme/repo", 1, resolutions, {});

    expect(client.replyToReviewComment).not.toHaveBeenCalled();
    expect(client.commentOnPR).toHaveBeenCalledTimes(1);
  });

  it("uses a fallback icon for an unrecognized status", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);
    const weird = [
      { findingId: "f9", status: "unknown_status" as ResolutionItem["status"], action: "a", rationale: "r" },
    ];

    await svc.postRemediationResolutions("acme/repo", 1, weird, { f9: 900 });

    const [, , , replyBody] = client.replyToReviewComment.mock.calls[0] as [string, number, number, string];
    expect(replyBody).toContain(":grey_question:");
  });
});
