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
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: 42,
    state: RunState.Implementing,
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

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "blocker",
    type: "bug",
    file: "src/foo.ts",
    lineHint: 10,
    title: "Null pointer",
    details: "Dereferences a possibly null value",
    ...overrides,
  };
}

function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
  return {
    findingId: "f1",
    status: "accepted",
    action: "Fixed null check",
    rationale: "Added a guard clause",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "All checks passed",
    filesChanged: ["src/a.ts", "src/b.ts"],
    checks: {
      lint: { status: "pass", details: "0 errors" },
      typecheck: { status: "pass", details: "0 errors" },
      tests: { status: "pass", details: "all green" },
    },
    notes: ["Refactored helper"],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "High confidence",
    ...overrides,
  };
}

describe("GitHubSyncService.syncState", () => {
  it("does nothing when the run has no PR number", async () => {
    const githubClient = makeGithubClient();
    const logger = makeLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    await svc.syncState(makeRun({ prNumber: null, state: RunState.ReadyForHumanReview }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });

  it("does nothing when the run state is not ReadyForHumanReview", async () => {
    const githubClient = makeGithubClient();
    const logger = makeLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    await svc.syncState(makeRun({ prNumber: 42, state: RunState.Implementing }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when the run is ReadyForHumanReview with a PR", async () => {
    const githubClient = makeGithubClient();
    const logger = makeLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const run = makeRun({ prNumber: 42, repo: "acme/widgets", state: RunState.ReadyForHumanReview });
    await svc.syncState(run);

    expect(githubClient.markPRReady).toHaveBeenCalledWith("acme/widgets", 42);
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "acme/widgets",
      42,
      "All AI checks passed. Ready for human review.",
    );
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "acme/widgets", prNumber: 42 },
      "Marked PR ready for review",
    );
  });

  it("propagates an error when markPRReady fails", async () => {
    const githubClient = makeGithubClient();
    githubClient.markPRReady.mockRejectedValue(new Error("github down"));
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await expect(
      svc.syncState(makeRun({ prNumber: 42, state: RunState.ReadyForHumanReview })),
    ).rejects.toThrow("github down");
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  it("posts one inline comment per finding and maps finding id -> comment id", async () => {
    const githubClient = makeGithubClient();
    githubClient.createPRReviewComment
      .mockResolvedValueOnce(111)
      .mockResolvedValueOnce(222);
    githubClient.submitPRReview.mockResolvedValue(undefined);
    const logger = makeLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const findings = [
      makeFinding({ id: "f1", severity: "blocker" }),
      makeFinding({ id: "f2", severity: "nit", title: "Style nit" }),
    ];

    const result = await svc.postReviewFindings("acme/widgets", 42, findings, "changes_requested");

    expect(githubClient.createPRReviewComment).toHaveBeenCalledTimes(2);
    expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
      1,
      "acme/widgets",
      42,
      expect.stringContaining("[BLOCKER]"),
      "src/foo.ts",
      10,
    );
    expect(result.get("f1")).toBe(111);
    expect(result.get("f2")).toBe(222);

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/widgets",
      42,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });

  it("submits an APPROVE review when the verdict is approved", async () => {
    const githubClient = makeGithubClient();
    githubClient.createPRReviewComment.mockResolvedValue(1);
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postReviewFindings("acme/widgets", 42, [makeFinding()], "approved");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/widgets",
      42,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("does not map a finding whose comment id is falsy (e.g. 0 or undefined)", async () => {
    const githubClient = makeGithubClient();
    githubClient.createPRReviewComment.mockResolvedValue(undefined);
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const result = await svc.postReviewFindings("acme/widgets", 42, [makeFinding()], "approved");

    expect(result.size).toBe(0);
  });

  it("returns an empty map and still submits a review when there are no findings", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const result = await svc.postReviewFindings("acme/widgets", 42, [], "approved");

    expect(result.size).toBe(0);
    expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/widgets",
      42,
      expect.stringContaining("0 finding(s)"),
      "APPROVE",
    );
  });

  it("propagates an error when creating a review comment fails", async () => {
    const githubClient = makeGithubClient();
    githubClient.createPRReviewComment.mockRejectedValue(new Error("rate limited"));
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await expect(
      svc.postReviewFindings("acme/widgets", 42, [makeFinding()], "approved"),
    ).rejects.toThrow("rate limited");
    expect(githubClient.submitPRReview).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  it("posts a comment including score, checks, and a flat files list under the collapse threshold", async () => {
    const githubClient = makeGithubClient();
    const logger = makeLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const report = makeExecutionReport({ score: 0.87 });
    await svc.postExecutionReportUpdate("acme/widgets", 42, report);

    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    const [repo, prNumber, body] = githubClient.commentOnPR.mock.calls[0];
    expect(repo).toBe("acme/widgets");
    expect(prNumber).toBe(42);
    expect(body).toContain("Score: 87%");
    expect(body).toContain(":white_check_mark: **Lint**");
    expect(body).toContain("Files changed (2)");
    expect(body).not.toContain("<details>");
    expect(body).toContain("### Notes");
    expect(body).toContain("Refactored helper");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "acme/widgets", prNumber: 42, filesChanged: 2 }),
      "Posted execution report update to PR",
    );
  });

  it("collapses the files list into a <details> block above the collapse threshold", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    const report = makeExecutionReport({ filesChanged: manyFiles });
    await svc.postExecutionReportUpdate("acme/widgets", 42, report);

    const [, , body] = githubClient.commentOnPR.mock.calls[0];
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });

  it("omits the files section entirely when no files changed", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postExecutionReportUpdate(
      "acme/widgets",
      42,
      makeExecutionReport({ filesChanged: [] }),
    );

    const [, , body] = githubClient.commentOnPR.mock.calls[0];
    expect(body).not.toContain("Files changed");
  });

  it("omits the notes section when there are no notes", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postExecutionReportUpdate("acme/widgets", 42, makeExecutionReport({ notes: [] }));

    const [, , body] = githubClient.commentOnPR.mock.calls[0];
    expect(body).not.toContain("### Notes");
  });

  it("renders fail and skip check icons correctly", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const report = makeExecutionReport({
      checks: {
        lint: { status: "fail", details: "2 errors" },
        typecheck: { status: "skip", details: "not run" },
        tests: { status: "pass", details: "ok" },
      },
    });
    await svc.postExecutionReportUpdate("acme/widgets", 42, report);

    const [, , body] = githubClient.commentOnPR.mock.calls[0];
    expect(body).toContain(":x: **Lint**");
    expect(body).toContain(":heavy_minus_sign: **Typecheck**");
    expect(body).toContain(":white_check_mark: **Tests**");
  });

  it("propagates an error when commentOnPR fails", async () => {
    const githubClient = makeGithubClient();
    githubClient.commentOnPR.mockRejectedValue(new Error("comment failed"));
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await expect(
      svc.postExecutionReportUpdate("acme/widgets", 42, makeExecutionReport()),
    ).rejects.toThrow("comment failed");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  it("replies to mapped comments and posts a summary table", async () => {
    const githubClient = makeGithubClient();
    const logger = makeLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const resolutions = [
      makeResolution({ findingId: "f1", status: "accepted" }),
      makeResolution({ findingId: "f2", status: "rejected", action: "No change", rationale: "Not valid" }),
    ];
    const commentMap = { f1: 111 };

    await svc.postRemediationResolutions("acme/widgets", 42, resolutions, commentMap);

    expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(1);
    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "acme/widgets",
      42,
      111,
      expect.stringContaining(":white_check_mark: **accepted**"),
    );

    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    const [, , summaryBody] = githubClient.commentOnPR.mock.calls[0];
    expect(summaryBody).toContain("## AI Remediation Summary");
    expect(summaryBody).toContain("f1");
    expect(summaryBody).toContain("f2");
    expect(summaryBody).toContain("rejected");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ resolutionCount: 2, repliedTo: 1 }),
      "Posted remediation resolutions to PR",
    );
  });

  it("skips replying when a resolution's findingId has no entry in the comment map", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postRemediationResolutions(
      "acme/widgets",
      42,
      [makeResolution({ findingId: "unmapped" })],
      {},
    );

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
  });

  it("uses a grey-question icon for an unrecognized resolution status", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const resolutions = [
      makeResolution({
        findingId: "f1",
        status: "partially_addressed",
      }),
    ];
    await svc.postRemediationResolutions("acme/widgets", 42, resolutions, { f1: 55 });

    const [, , , replyBody] = githubClient.replyToReviewComment.mock.calls[0];
    expect(replyBody).toContain(":warning:");
  });

  it("propagates an error when replyToReviewComment fails", async () => {
    const githubClient = makeGithubClient();
    githubClient.replyToReviewComment.mockRejectedValue(new Error("reply failed"));
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await expect(
      svc.postRemediationResolutions(
        "acme/widgets",
        42,
        [makeResolution({ findingId: "f1" })],
        { f1: 55 },
      ),
    ).rejects.toThrow("reply failed");
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });
});
