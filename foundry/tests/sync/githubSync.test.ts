import { describe, it, expect, vi } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { GitHubClient } from "../../src/github/githubClient.js";
import type { Logger } from "../../src/utils/logger.js";
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
    repo: "test-repo",
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

function makeGithubClient(): GitHubClient {
  return {
    verifyRepoAccess: vi.fn(),
    getDefaultBranch: vi.fn(),
    createBranch: vi.fn(),
    createDraftPR: vi.fn(),
    commentOnPR: vi.fn().mockResolvedValue(undefined),
    getPRDiff: vi.fn(),
    markPRReady: vi.fn().mockResolvedValue(undefined),
    listPRComments: vi.fn(),
    createPRReviewComment: vi.fn().mockResolvedValue(101),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
    submitPRReview: vi.fn().mockResolvedValue(undefined),
  } as unknown as GitHubClient;
}

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "blocker",
    type: "bug",
    file: "src/foo.ts",
    lineHint: 10,
    title: "Null deref",
    details: "This will throw.",
    ...overrides,
  };
}

function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
  return {
    findingId: "f1",
    status: "accepted",
    action: "Added a null check",
    rationale: "Prevents the crash",
    ...overrides,
  };
}

function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts", "src/b.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "fail", details: "1 failing" },
    },
    notes: ["Note one"],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Mostly solid",
    ...overrides,
  };
}

describe("GitHubSyncService.syncState", () => {
  it("does nothing when the run has no prNumber", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client, makeLogger());
    await svc.syncState(makeRun({ prNumber: null, state: RunState.ReadyForHumanReview }));

    expect(client.markPRReady).not.toHaveBeenCalled();
    expect(client.commentOnPR).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when the run state is ReadyForHumanReview", async () => {
    const client = makeGithubClient();
    const logger = makeLogger();
    const svc = new GitHubSyncService(client, logger);
    await svc.syncState(makeRun({ prNumber: 7, state: RunState.ReadyForHumanReview }));

    expect(client.markPRReady).toHaveBeenCalledWith("test-repo", 7);
    expect(client.commentOnPR).toHaveBeenCalledWith(
      "test-repo",
      7,
      "All AI checks passed. Ready for human review.",
    );
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "test-repo", prNumber: 7 },
      "Marked PR ready for review",
    );
  });

  it("does not mark ready or comment for any other run state", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client, makeLogger());
    await svc.syncState(makeRun({ prNumber: 7, state: RunState.Implementing }));

    expect(client.markPRReady).not.toHaveBeenCalled();
    expect(client.commentOnPR).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  it("posts one review comment per finding, maps finding id to comment id, and submits an APPROVE review", async () => {
    const client = makeGithubClient();
    const logger = makeLogger();
    const svc = new GitHubSyncService(client, logger);
    const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2", severity: "nit" })];

    const result = await svc.postReviewFindings("repo-x", 5, findings, "approved");

    expect(client.createPRReviewComment).toHaveBeenCalledTimes(2);
    expect(client.createPRReviewComment).toHaveBeenNthCalledWith(
      1,
      "repo-x",
      5,
      expect.stringContaining("[BLOCKER]"),
      "src/foo.ts",
      10,
    );
    expect(result.get("f1")).toBe(101);
    expect(result.get("f2")).toBe(101);
    expect(result.size).toBe(2);

    expect(client.submitPRReview).toHaveBeenCalledWith(
      "repo-x",
      5,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "repo-x", prNumber: 5, findingsCount: 2, verdict: "approved" }),
      "Posted review findings as PR review comments",
    );
  });

  it("submits REQUEST_CHANGES when verdict is not approved", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client, makeLogger());

    await svc.postReviewFindings("repo-x", 5, [makeFinding()], "changes_requested");

    expect(client.submitPRReview).toHaveBeenCalledWith(
      "repo-x",
      5,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });

  it("does not map a finding whose comment creation returns a falsy id", async () => {
    const client = makeGithubClient();
    (client.createPRReviewComment as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    const svc = new GitHubSyncService(client, makeLogger());

    const result = await svc.postReviewFindings("repo-x", 5, [makeFinding({ id: "f1" })], "approved");

    expect(result.has("f1")).toBe(false);
    expect(result.size).toBe(0);
  });

  it("handles an empty findings list by still submitting a review with a zero count", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client, makeLogger());

    const result = await svc.postReviewFindings("repo-x", 5, [], "approved");

    expect(client.createPRReviewComment).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
    expect(client.submitPRReview).toHaveBeenCalledWith(
      "repo-x",
      5,
      expect.stringContaining("0 finding(s)"),
      "APPROVE",
    );
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  it("comments on the PR with score, checks, and files-changed sections for a small file list", async () => {
    const client = makeGithubClient();
    const logger = makeLogger();
    const svc = new GitHubSyncService(client, logger);
    const report = makeReport({ filesChanged: ["src/a.ts", "src/b.ts"] });

    await svc.postExecutionReportUpdate("repo-x", 9, report);

    expect(client.commentOnPR).toHaveBeenCalledTimes(1);
    const [repo, prNumber, body] = (client.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(repo).toBe("repo-x");
    expect(prNumber).toBe(9);
    expect(body).toContain("Score: 80%");
    expect(body).toContain(":white_check_mark: **Lint**");
    expect(body).toContain(":x: **Tests**");
    expect(body).toContain("### Files changed (2)");
    expect(body).toContain("`src/a.ts`");
    expect(body).not.toContain("<details>");
    expect(body).toContain("### Notes");
    expect(body).toContain("- Note one");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "repo-x", prNumber: 9, executionVersion: 1, score: 0.8 }),
      "Posted execution report update to PR",
    );
  });

  it("collapses the files-changed section into a <details> block above the threshold", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client, makeLogger());
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    const report = makeReport({ filesChanged: manyFiles });

    await svc.postExecutionReportUpdate("repo-x", 9, report);

    const [, , body] = (client.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body).toContain("<details>");
    expect(body).toContain(`Files changed (${manyFiles.length})`);
  });

  it("omits the files-changed section entirely when there are no changed files", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client, makeLogger());
    const report = makeReport({ filesChanged: [] });

    await svc.postExecutionReportUpdate("repo-x", 9, report);

    const [, , body] = (client.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body).not.toContain("Files changed");
  });

  it("omits the notes section when there are no notes", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client, makeLogger());
    const report = makeReport({ notes: [] });

    await svc.postExecutionReportUpdate("repo-x", 9, report);

    const [, , body] = (client.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body).not.toContain("### Notes");
  });

  it("renders the skip icon for a check with a non-pass/fail status", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client, makeLogger());
    const report = makeReport({
      checks: {
        lint: { status: "skip", details: "n/a" },
        typecheck: { status: "pass", details: "clean" },
        tests: { status: "pass", details: "clean" },
      },
    });

    await svc.postExecutionReportUpdate("repo-x", 9, report);

    const [, , body] = (client.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body).toContain(":heavy_minus_sign: **Lint**");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  it("replies to the mapped review comment for each resolution and posts a summary table", async () => {
    const client = makeGithubClient();
    const logger = makeLogger();
    const svc = new GitHubSyncService(client, logger);
    const resolutions = [
      makeResolution({ findingId: "f1", status: "accepted" }),
      makeResolution({ findingId: "f2", status: "rejected", action: "No change", rationale: "Not a bug" }),
    ];
    const commentMap = { f1: 201, f2: 202 };

    await svc.postRemediationResolutions("repo-x", 3, resolutions, commentMap);

    expect(client.replyToReviewComment).toHaveBeenCalledTimes(2);
    expect(client.replyToReviewComment).toHaveBeenNthCalledWith(
      1,
      "repo-x",
      3,
      201,
      expect.stringContaining(":white_check_mark: **accepted**"),
    );
    expect(client.replyToReviewComment).toHaveBeenNthCalledWith(
      2,
      "repo-x",
      3,
      202,
      expect.stringContaining(":no_entry_sign: **rejected**"),
    );

    expect(client.commentOnPR).toHaveBeenCalledTimes(1);
    const [, , summaryBody] = (client.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(summaryBody).toContain("## AI Remediation Summary");
    expect(summaryBody).toContain("f1");
    expect(summaryBody).toContain("f2");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "repo-x", prNumber: 3, resolutionCount: 2, repliedTo: 2 }),
      "Posted remediation resolutions to PR",
    );
  });

  it("skips replying when a resolution has no corresponding comment id in the map", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client, makeLogger());
    const resolutions = [makeResolution({ findingId: "unmapped" })];

    await svc.postRemediationResolutions("repo-x", 3, resolutions, {});

    expect(client.replyToReviewComment).not.toHaveBeenCalled();
    expect(client.commentOnPR).toHaveBeenCalledTimes(1);
  });

  it("falls back to a question mark icon for an unknown resolution status", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client, makeLogger());
    const resolutions = [
      { findingId: "f1", status: "something_else", action: "a", rationale: "r" } as unknown as ResolutionItem,
    ];

    await svc.postRemediationResolutions("repo-x", 3, resolutions, { f1: 55 });

    expect(client.replyToReviewComment).toHaveBeenCalledWith(
      "repo-x",
      3,
      55,
      expect.stringContaining(":grey_question:"),
    );
    const [, , summaryBody] = (client.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(summaryBody).toContain(":grey_question:");
  });

  it("renders partially_addressed status with its warning icon", async () => {
    const client = makeGithubClient();
    const svc = new GitHubSyncService(client, makeLogger());
    const resolutions = [makeResolution({ findingId: "f1", status: "partially_addressed" })];

    await svc.postRemediationResolutions("repo-x", 3, resolutions, { f1: 60 });

    expect(client.replyToReviewComment).toHaveBeenCalledWith(
      "repo-x",
      3,
      60,
      expect.stringContaining(":warning:"),
    );
  });
});
