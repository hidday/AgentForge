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

function makeClient() {
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
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: "ai/lin-1",
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

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "important",
    type: "bug",
    file: "src/a.ts",
    lineHint: 10,
    title: "Off-by-one",
    details: "Loop bound is wrong",
    ...overrides,
  };
}

function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts", "src/b.ts"],
    checks: {
      lint: { status: "pass", details: "0 errors" },
      typecheck: { status: "pass", details: "0 errors" },
      tests: { status: "fail", details: "1 test failed" },
    },
    notes: ["Consider refactoring later"],
    prDraftCreated: true,
    score: 0.82,
    scoreRationale: "Solid implementation with one failing test",
    ...overrides,
  };
}

describe("GitHubSyncService.syncState", () => {
  it("is a no-op when the run has no PR number yet", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.syncState(makeRun({ prNumber: null, state: RunState.ReadyForHumanReview }));

    expect(client.markPRReady).not.toHaveBeenCalled();
    expect(client.commentOnPR).not.toHaveBeenCalled();
  });

  it("is a no-op when the run has a PR but is not in ReadyForHumanReview", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Implementing }));

    expect(client.markPRReady).not.toHaveBeenCalled();
    expect(client.commentOnPR).not.toHaveBeenCalled();
  });

  it("marks the PR ready and posts a comment when the run reaches ReadyForHumanReview", async () => {
    const client = makeClient();
    const logger = makeLogger();
    const svc = new GitHubSyncService(client as never, logger as never);

    await svc.syncState(makeRun({ repo: "org/repo", prNumber: 42, state: RunState.ReadyForHumanReview }));

    expect(client.markPRReady).toHaveBeenCalledWith("org/repo", 42);
    expect(client.commentOnPR).toHaveBeenCalledWith(
      "org/repo",
      42,
      "All AI checks passed. Ready for human review.",
    );
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "org/repo", prNumber: 42 },
      "Marked PR ready for review",
    );
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  it("posts an inline comment per finding and a summary review; maps findingId to commentId", async () => {
    const client = makeClient();
    client.createPRReviewComment.mockResolvedValueOnce(101).mockResolvedValueOnce(102);
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2", severity: "blocker" })];
    const commentMap = await svc.postReviewFindings("org/repo", 1, findings, "changes_requested");

    expect(client.createPRReviewComment).toHaveBeenCalledTimes(2);
    expect(client.createPRReviewComment).toHaveBeenNthCalledWith(
      1,
      "org/repo",
      1,
      expect.stringContaining("[IMPORTANT]"),
      "src/a.ts",
      10,
    );
    expect(commentMap.get("f1")).toBe(101);
    expect(commentMap.get("f2")).toBe(102);
    expect(client.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      1,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });

  it("uses APPROVE for an approved verdict", async () => {
    const client = makeClient();
    client.createPRReviewComment.mockResolvedValue(1);
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postReviewFindings("org/repo", 1, [], "approved");

    expect(client.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      1,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("does not map a finding into commentMap when createPRReviewComment returns a falsy id (0)", async () => {
    const client = makeClient();
    client.createPRReviewComment.mockResolvedValue(0);
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    const commentMap = await svc.postReviewFindings("org/repo", 1, [makeFinding()], "approved");

    expect(commentMap.size).toBe(0);
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  it("posts a formatted comment including score, checks, and a flat file list under the collapse threshold", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postExecutionReportUpdate("org/repo", 1, makeReport());

    expect(client.commentOnPR).toHaveBeenCalledTimes(1);
    const [repo, prNumber, body] = client.commentOnPR.mock.calls[0]!;
    expect(repo).toBe("org/repo");
    expect(prNumber).toBe(1);
    expect(body).toContain("Score: 82%");
    expect(body).toContain(":white_check_mark: **Lint**");
    expect(body).toContain(":x: **Tests**");
    expect(body).toContain("### Files changed (2)");
    expect(body).toContain("`src/a.ts`");
    expect(body).not.toContain("<details>");
    expect(body).toContain("### Notes");
  });

  it("collapses the file list into a <details> block above the threshold (>8 files)", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);

    await svc.postExecutionReportUpdate("org/repo", 1, makeReport({ filesChanged: manyFiles }));

    const [, , body] = client.commentOnPR.mock.calls[0]!;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });

  it("omits the files section entirely when filesChanged is empty", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postExecutionReportUpdate("org/repo", 1, makeReport({ filesChanged: [] }));

    const [, , body] = client.commentOnPR.mock.calls[0]!;
    expect(body).not.toContain("Files changed");
  });

  it("omits the notes section when notes is empty", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postExecutionReportUpdate("org/repo", 1, makeReport({ notes: [] }));

    const [, , body] = client.commentOnPR.mock.calls[0]!;
    expect(body).not.toContain("### Notes");
  });

  it("renders a skip icon for a check with 'skip' status", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postExecutionReportUpdate(
      "org/repo",
      1,
      makeReport({
        checks: {
          lint: { status: "skip", details: "not run" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      }),
    );

    const [, , body] = client.commentOnPR.mock.calls[0]!;
    expect(body).toContain(":heavy_minus_sign: **Lint**");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
    return {
      findingId: "f1",
      status: "accepted",
      action: "Fixed the loop bound",
      rationale: "Confirmed with a regression test",
      ...overrides,
    };
  }

  it("replies to each mapped finding's GitHub comment and posts a summary table", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    const resolutions = [
      makeResolution({ findingId: "f1", status: "accepted" }),
      makeResolution({ findingId: "f2", status: "rejected" }),
      makeResolution({ findingId: "f3", status: "partially_addressed" }),
    ];
    const commentMap = { f1: 101, f2: 102 }; // f3 has no mapped GitHub comment

    await svc.postRemediationResolutions("org/repo", 1, resolutions, commentMap);

    expect(client.replyToReviewComment).toHaveBeenCalledTimes(2);
    expect(client.replyToReviewComment).toHaveBeenCalledWith(
      "org/repo",
      1,
      101,
      expect.stringContaining(":white_check_mark:"),
    );
    expect(client.replyToReviewComment).toHaveBeenCalledWith(
      "org/repo",
      1,
      102,
      expect.stringContaining(":no_entry_sign:"),
    );

    expect(client.commentOnPR).toHaveBeenCalledTimes(1);
    const [, , summaryBody] = client.commentOnPR.mock.calls[0]!;
    expect(summaryBody).toContain("## AI Remediation Summary");
    expect(summaryBody).toContain("f1");
    expect(summaryBody).toContain("f2");
    expect(summaryBody).toContain("f3");
    expect(summaryBody).toContain(":warning:");
  });

  it("falls back to a question-mark icon for an unrecognised status", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postRemediationResolutions(
      "org/repo",
      1,
      [makeResolution({ findingId: "f1", status: "weird-status" as ResolutionItem["status"] })],
      {},
    );

    const [, , summaryBody] = client.commentOnPR.mock.calls[0]!;
    expect(summaryBody).toContain(":grey_question:");
  });

  it("posts only the summary (no replies) when the resolutions list is empty", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postRemediationResolutions("org/repo", 1, [], {});

    expect(client.replyToReviewComment).not.toHaveBeenCalled();
    expect(client.commentOnPR).toHaveBeenCalledTimes(1);
  });
});
