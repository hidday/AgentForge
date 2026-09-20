import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Finding } from "../../src/schemas/review.js";
import type { ResolutionItem } from "../../src/schemas/remediation.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { GitHubClient } from "../../src/github/githubClient.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/backend",
    branchName: "ai/lin-1",
    prNumber: 42,
    state: RunState.ReadyForHumanReview,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/repo",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeGitHubClient(): { [K in keyof GitHubClient]: ReturnType<typeof vi.fn> } {
  return {
    verifyRepoAccess: vi.fn().mockResolvedValue(undefined),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
    createBranch: vi.fn().mockResolvedValue(undefined),
    createDraftPR: vi.fn().mockResolvedValue(1),
    commentOnPR: vi.fn().mockResolvedValue(undefined),
    getPRDiff: vi.fn().mockResolvedValue(""),
    markPRReady: vi.fn().mockResolvedValue(undefined),
    listPRComments: vi.fn().mockResolvedValue([]),
    createPRReviewComment: vi.fn().mockResolvedValue(1000),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
    submitPRReview: vi.fn().mockResolvedValue(undefined),
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "important",
    type: "bug",
    file: "src/foo.ts",
    lineHint: 12,
    title: "Missing null check",
    details: "Will throw if foo is null",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
    filesChanged: ["src/a.ts", "src/b.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "fail", details: "1 failing" },
    },
    notes: ["Note one"],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Good enough",
    ...overrides,
  };
}

describe("GitHubSyncService.syncState", () => {
  let client: ReturnType<typeof makeGitHubClient>;
  let logger: ReturnType<typeof makeLogger>;
  let service: GitHubSyncService;

  beforeEach(() => {
    client = makeGitHubClient();
    logger = makeLogger();
    service = new GitHubSyncService(client as unknown as GitHubClient, logger as never);
  });

  it("does nothing when the run has no PR number", async () => {
    await service.syncState(makeRun({ prNumber: null }));

    expect(client.markPRReady).not.toHaveBeenCalled();
    expect(client.commentOnPR).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when the run reaches ReadyForHumanReview", async () => {
    const run = makeRun({ prNumber: 7, repo: "acme/backend", state: RunState.ReadyForHumanReview });

    await service.syncState(run);

    expect(client.markPRReady).toHaveBeenCalledWith("acme/backend", 7);
    expect(client.commentOnPR).toHaveBeenCalledWith(
      "acme/backend",
      7,
      "All AI checks passed. Ready for human review.",
    );
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "acme/backend", prNumber: 7 },
      "Marked PR ready for review",
    );
  });

  it("is a no-op for states other than ReadyForHumanReview even with a PR number", async () => {
    const run = makeRun({ prNumber: 7, state: RunState.Implementing });

    await service.syncState(run);

    expect(client.markPRReady).not.toHaveBeenCalled();
    expect(client.commentOnPR).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it("propagates an error when the GitHub API call fails", async () => {
    client.markPRReady.mockRejectedValueOnce(new Error("GitHub API down"));
    const run = makeRun({ prNumber: 7, state: RunState.ReadyForHumanReview });

    await expect(service.syncState(run)).rejects.toThrow("GitHub API down");
    expect(client.commentOnPR).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  let client: ReturnType<typeof makeGitHubClient>;
  let logger: ReturnType<typeof makeLogger>;
  let service: GitHubSyncService;

  beforeEach(() => {
    client = makeGitHubClient();
    logger = makeLogger();
    service = new GitHubSyncService(client as unknown as GitHubClient, logger as never);
  });

  it("posts one review comment per finding and maps finding id to comment id", async () => {
    client.createPRReviewComment
      .mockResolvedValueOnce(1001)
      .mockResolvedValueOnce(1002);
    const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2", severity: "nit" })];

    const commentMap = await service.postReviewFindings("acme/backend", 7, findings, "changes_requested");

    expect(client.createPRReviewComment).toHaveBeenCalledTimes(2);
    expect(client.createPRReviewComment).toHaveBeenNthCalledWith(
      1,
      "acme/backend",
      7,
      expect.stringContaining("[IMPORTANT]"),
      "src/foo.ts",
      12,
    );
    expect(commentMap.get("f1")).toBe(1001);
    expect(commentMap.get("f2")).toBe(1002);
  });

  it("skips mapping a finding when the client returns no comment id (malformed/failed post)", async () => {
    client.createPRReviewComment.mockResolvedValueOnce(0);
    const findings = [makeFinding({ id: "f1" })];

    const commentMap = await service.postReviewFindings("acme/backend", 7, findings, "approved");

    expect(commentMap.has("f1")).toBe(false);
  });

  it("submits an APPROVE review event when the verdict is approved", async () => {
    await service.postReviewFindings("acme/backend", 7, [], "approved");

    expect(client.submitPRReview).toHaveBeenCalledWith(
      "acme/backend",
      7,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("submits a REQUEST_CHANGES review event for any non-approved verdict", async () => {
    await service.postReviewFindings("acme/backend", 7, [], "changes_requested");

    expect(client.submitPRReview).toHaveBeenCalledWith(
      "acme/backend",
      7,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });

  it("handles an empty findings array without posting inline comments", async () => {
    const commentMap = await service.postReviewFindings("acme/backend", 7, [], "approved");

    expect(client.createPRReviewComment).not.toHaveBeenCalled();
    expect(commentMap.size).toBe(0);
    expect(client.submitPRReview).toHaveBeenCalledWith(
      "acme/backend",
      7,
      expect.stringContaining("0 finding(s)"),
      "APPROVE",
    );
  });

  it("propagates an error when posting an inline comment fails", async () => {
    client.createPRReviewComment.mockRejectedValueOnce(new Error("rate limited"));

    await expect(
      service.postReviewFindings("acme/backend", 7, [makeFinding()], "approved"),
    ).rejects.toThrow("rate limited");
    expect(client.submitPRReview).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  let client: ReturnType<typeof makeGitHubClient>;
  let logger: ReturnType<typeof makeLogger>;
  let service: GitHubSyncService;

  beforeEach(() => {
    client = makeGitHubClient();
    logger = makeLogger();
    service = new GitHubSyncService(client as unknown as GitHubClient, logger as never);
  });

  it("renders score, check icons, and a non-collapsed files list at or below the threshold", async () => {
    const report = makeExecutionReport({ filesChanged: ["a.ts", "b.ts"], score: 0.5 });

    await service.postExecutionReportUpdate("acme/backend", 7, report);

    const body = client.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("Score: 50%");
    expect(body).toContain(":white_check_mark: **Lint**");
    expect(body).toContain(":white_check_mark: **Typecheck**");
    expect(body).toContain(":x: **Tests**");
    expect(body).toContain("### Files changed (2)");
    expect(body).not.toContain("<details>");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "acme/backend", prNumber: 7, filesChanged: 2 }),
      "Posted execution report update to PR",
    );
  });

  it("collapses the files list into a <details> block above the threshold", async () => {
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);
    const report = makeExecutionReport({ filesChanged: manyFiles });

    await service.postExecutionReportUpdate("acme/backend", 7, report);

    const body = client.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });

  it("omits the files section entirely when no files changed", async () => {
    const report = makeExecutionReport({ filesChanged: [] });

    await service.postExecutionReportUpdate("acme/backend", 7, report);

    const body = client.commentOnPR.mock.calls[0][2] as string;
    expect(body).not.toContain("Files changed");
  });

  it("omits the notes section when notes is empty but includes it otherwise", async () => {
    await service.postExecutionReportUpdate(
      "acme/backend",
      7,
      makeExecutionReport({ notes: [] }),
    );
    let body = client.commentOnPR.mock.calls[0][2] as string;
    expect(body).not.toContain("### Notes");

    await service.postExecutionReportUpdate(
      "acme/backend",
      7,
      makeExecutionReport({ notes: ["Did a thing"] }),
    );
    body = client.commentOnPR.mock.calls[1][2] as string;
    expect(body).toContain("### Notes");
    expect(body).toContain("Did a thing");
  });

  it("renders the skip icon for a status that is neither pass nor fail", async () => {
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "skip", details: "skipped" },
        tests: { status: "pass", details: "ok" },
      },
    });

    await service.postExecutionReportUpdate("acme/backend", 7, report);

    const body = client.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain(":heavy_minus_sign: **Typecheck**");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  let client: ReturnType<typeof makeGitHubClient>;
  let logger: ReturnType<typeof makeLogger>;
  let service: GitHubSyncService;

  function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
    return {
      findingId: "f1",
      status: "accepted",
      action: "Added null guard",
      rationale: "Real bug",
      ...overrides,
    };
  }

  beforeEach(() => {
    client = makeGitHubClient();
    logger = makeLogger();
    service = new GitHubSyncService(client as unknown as GitHubClient, logger as never);
  });

  it("replies to review comments that have a known GitHub comment id", async () => {
    const resolutions = [makeResolution({ findingId: "f1" })];
    const commentMap = { f1: 1001 };

    await service.postRemediationResolutions("acme/backend", 7, resolutions, commentMap);

    expect(client.replyToReviewComment).toHaveBeenCalledWith(
      "acme/backend",
      7,
      1001,
      expect.stringContaining("accepted"),
    );
  });

  it("skips replying when a resolution has no corresponding comment id", async () => {
    const resolutions = [makeResolution({ findingId: "unmapped" })];

    await service.postRemediationResolutions("acme/backend", 7, resolutions, {});

    expect(client.replyToReviewComment).not.toHaveBeenCalled();
    // Summary comment is still posted.
    expect(client.commentOnPR).toHaveBeenCalledTimes(1);
  });

  it("uses a fallback icon for an unrecognized resolution status", async () => {
    const resolutions = [
      { findingId: "f1", status: "mystery" as ResolutionItem["status"], action: "n/a", rationale: "n/a" },
    ];

    await service.postRemediationResolutions("acme/backend", 7, resolutions, { f1: 1001 });

    const replyBody = client.replyToReviewComment.mock.calls[0][3] as string;
    expect(replyBody).toContain(":grey_question:");
    const summaryBody = client.commentOnPR.mock.calls[0][2] as string;
    expect(summaryBody).toContain(":grey_question:");
  });

  it("builds a markdown summary table with one row per resolution and logs a summary", async () => {
    const resolutions = [
      makeResolution({ findingId: "f1", status: "accepted" }),
      makeResolution({ findingId: "f2", status: "rejected", action: "No change", rationale: "Style" }),
    ];

    await service.postRemediationResolutions("acme/backend", 7, resolutions, { f1: 1001 });

    const summaryBody = client.commentOnPR.mock.calls[0][2] as string;
    expect(summaryBody).toContain("## AI Remediation Summary");
    expect(summaryBody).toContain("f1");
    expect(summaryBody).toContain("f2");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "acme/backend", prNumber: 7, resolutionCount: 2, repliedTo: 1 }),
      "Posted remediation resolutions to PR",
    );
  });
});
