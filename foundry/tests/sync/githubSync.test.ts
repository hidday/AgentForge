import { describe, it, expect, vi } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Finding } from "../../src/schemas/review.js";
import type { ResolutionItem } from "../../src/schemas/remediation.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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
    createPRReviewComment: vi.fn(),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
    submitPRReview: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/backend",
    branchName: "ai/lin-1",
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 2,
    summary: "Fixed the bug and re-ran checks.",
    filesChanged: ["src/a.ts", "src/b.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "fail", details: "1 failing" },
    },
    notes: ["Note one"],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Solid.",
    ...overrides,
  };
}

describe("GitHubSyncService.syncState", () => {
  it("marks the PR ready and comments when the run is ReadyForHumanReview", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);

    await svc.syncState(makeRun());

    expect(github.markPRReady).toHaveBeenCalledWith("acme/backend", 42);
    expect(github.commentOnPR).toHaveBeenCalledWith(
      "acme/backend",
      42,
      expect.stringContaining("Ready for human review"),
    );
  });

  it("does nothing when the run has no PR number yet", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);

    await svc.syncState(makeRun({ prNumber: null }));

    expect(github.markPRReady).not.toHaveBeenCalled();
    expect(github.commentOnPR).not.toHaveBeenCalled();
  });

  it("does nothing for states other than ReadyForHumanReview", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Implementing }));

    expect(github.markPRReady).not.toHaveBeenCalled();
    expect(github.commentOnPR).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  function makeFinding(overrides: Partial<Finding> = {}): Finding {
    return {
      id: "f1",
      severity: "important",
      type: "bug",
      file: "src/foo.ts",
      lineHint: 12,
      title: "Missing null check",
      details: "Will throw",
      ...overrides,
    };
  }

  it("posts a review comment per finding and maps ids to GitHub comment ids", async () => {
    const github = makeGithubClient();
    github.createPRReviewComment.mockResolvedValueOnce(501).mockResolvedValueOnce(502);
    const svc = new GitHubSyncService(github as never, makeLogger() as never);

    const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2", severity: "nit" })];
    const map = await svc.postReviewFindings("acme/backend", 42, findings, "changes_requested");

    expect(map.get("f1")).toBe(501);
    expect(map.get("f2")).toBe(502);
    expect(github.submitPRReview).toHaveBeenCalledWith(
      "acme/backend",
      42,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });

  it("submits an APPROVE review when the verdict is approved", async () => {
    const github = makeGithubClient();
    github.createPRReviewComment.mockResolvedValue(1);
    const svc = new GitHubSyncService(github as never, makeLogger() as never);

    await svc.postReviewFindings("acme/backend", 42, [makeFinding()], "approved");

    expect(github.submitPRReview).toHaveBeenCalledWith(
      "acme/backend",
      42,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("skips mapping a finding when createPRReviewComment returns 0 (comment could not be posted)", async () => {
    const github = makeGithubClient();
    github.createPRReviewComment.mockResolvedValue(0);
    const svc = new GitHubSyncService(github as never, makeLogger() as never);

    const map = await svc.postReviewFindings(
      "acme/backend",
      42,
      [makeFinding({ id: "f1" })],
      "changes_requested",
    );

    expect(map.has("f1")).toBe(false);
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  it("renders a collapsed file list when files changed exceeds the threshold", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);

    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);
    await svc.postExecutionReportUpdate(
      "acme/backend",
      42,
      makeExecutionReport({ filesChanged: manyFiles }),
    );

    const body = github.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });

  it("renders a plain file list section when at or below the threshold", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);

    await svc.postExecutionReportUpdate(
      "acme/backend",
      42,
      makeExecutionReport({ filesChanged: ["src/a.ts"] }),
    );

    const body = github.commentOnPR.mock.calls[0][2] as string;
    expect(body).not.toContain("<details>");
    expect(body).toContain("### Files changed (1)");
  });

  it("omits the files-changed section entirely when there are no files", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);

    await svc.postExecutionReportUpdate(
      "acme/backend",
      42,
      makeExecutionReport({ filesChanged: [] }),
    );

    const body = github.commentOnPR.mock.calls[0][2] as string;
    expect(body).not.toContain("Files changed");
  });

  it("omits the notes section when there are no notes", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);

    await svc.postExecutionReportUpdate(
      "acme/backend",
      42,
      makeExecutionReport({ notes: [] }),
    );

    const body = github.commentOnPR.mock.calls[0][2] as string;
    expect(body).not.toContain("### Notes");
  });

  it("renders the score percentage and each check's status icon", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);

    await svc.postExecutionReportUpdate(
      "acme/backend",
      42,
      makeExecutionReport({
        score: 0.9,
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "fail", details: "bad" },
          tests: { status: "skip", details: "n/a" },
        },
      }),
    );

    const body = github.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("Score: 90%");
    expect(body).toContain(":white_check_mark:");
    expect(body).toContain(":x:");
    expect(body).toContain(":heavy_minus_sign:");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
    return {
      findingId: "f1",
      status: "accepted",
      action: "Added a null check",
      rationale: "Real bug",
      ...overrides,
    };
  }

  it("replies to each finding's GitHub comment id and posts a markdown summary table", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);

    const resolutions = [
      makeResolution({ findingId: "f1", status: "accepted" }),
      makeResolution({ findingId: "f2", status: "rejected" }),
      makeResolution({ findingId: "f3", status: "partially_addressed" }),
    ];
    const commentMap = { f1: 501, f2: 502 };

    await svc.postRemediationResolutions("acme/backend", 42, resolutions, commentMap);

    expect(github.replyToReviewComment).toHaveBeenCalledTimes(2);
    expect(github.replyToReviewComment).toHaveBeenCalledWith(
      "acme/backend",
      42,
      501,
      expect.stringContaining("accepted"),
    );
    const summaryBody = github.commentOnPR.mock.calls[0][2] as string;
    expect(summaryBody).toContain("f1");
    expect(summaryBody).toContain("f3");
    expect(summaryBody).toContain(":warning:");
  });

  it("skips replying when a finding has no mapped GitHub comment id", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);

    await svc.postRemediationResolutions(
      "acme/backend",
      42,
      [makeResolution({ findingId: "unmapped" })],
      {},
    );

    expect(github.replyToReviewComment).not.toHaveBeenCalled();
    expect(github.commentOnPR).toHaveBeenCalled();
  });

  it("falls back to a grey question icon for an unrecognized status", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);

    await svc.postRemediationResolutions(
      "acme/backend",
      42,
      [makeResolution({ findingId: "f1", status: "weird_status" as never })],
      { f1: 501 },
    );

    expect(github.replyToReviewComment).toHaveBeenCalledWith(
      "acme/backend",
      42,
      501,
      expect.stringContaining(":grey_question:"),
    );
  });
});
