import { describe, it, expect, vi, beforeEach } from "vitest";
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
    repo: "acme/widgets",
    branchName: "ai/lin-1",
    prNumber: 42,
    state: RunState.Implementing,
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
    severity: "blocker",
    type: "bug",
    file: "src/handler.ts",
    title: "Null deref",
    details: "This will throw if the input is empty.",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 2,
    summary: "Implemented the feature and fixed lint issues.",
    filesChanged: ["src/a.ts", "src/b.ts"],
    checks: {
      lint: { status: "pass", details: "0 problems" },
      typecheck: { status: "pass", details: "no errors" },
      tests: { status: "fail", details: "1 failing test" },
    },
    notes: ["Left a TODO for follow-up caching."],
    prDraftCreated: true,
    score: 0.75,
    scoreRationale: "Tests failing but implementation is otherwise solid.",
    ...overrides,
  };
}

function buildGithubClient() {
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

function buildLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("GitHubSyncService.syncState", () => {
  let githubClient: ReturnType<typeof buildGithubClient>;
  let logger: ReturnType<typeof buildLogger>;
  let svc: GitHubSyncService;

  beforeEach(() => {
    githubClient = buildGithubClient();
    logger = buildLogger();
    svc = new GitHubSyncService(githubClient as never, logger as never);
  });

  it("marks the PR ready and comments when the run reaches ReadyForHumanReview", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7, repo: "acme/widgets" });

    await svc.syncState(run);

    expect(githubClient.markPRReady).toHaveBeenCalledWith("acme/widgets", 7);
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "acme/widgets",
      7,
      "All AI checks passed. Ready for human review.",
    );
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the run has no PR number, regardless of state", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, prNumber: null });

    await svc.syncState(run);

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it("does nothing for states other than ReadyForHumanReview", async () => {
    const run = makeRun({ state: RunState.Implementing, prNumber: 7 });

    await svc.syncState(run);

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });

  it("propagates errors from the GitHub client", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7 });
    githubClient.markPRReady.mockRejectedValueOnce(new Error("API rate limited"));

    await expect(svc.syncState(run)).rejects.toThrow("API rate limited");
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  let githubClient: ReturnType<typeof buildGithubClient>;
  let logger: ReturnType<typeof buildLogger>;
  let svc: GitHubSyncService;

  beforeEach(() => {
    githubClient = buildGithubClient();
    logger = buildLogger();
    svc = new GitHubSyncService(githubClient as never, logger as never);
  });

  it("posts one inline review comment per finding and maps finding id to comment id", async () => {
    githubClient.createPRReviewComment
      .mockResolvedValueOnce(1001)
      .mockResolvedValueOnce(1002);
    const findings = [
      makeFinding({ id: "f1", severity: "blocker", file: "src/a.ts", lineHint: 12 }),
      makeFinding({ id: "f2", severity: "nit", file: "src/b.ts" }),
    ];

    const result = await svc.postReviewFindings("acme/widgets", 7, findings, "changes_requested");

    expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
      1,
      "acme/widgets",
      7,
      expect.stringContaining("**[BLOCKER]**"),
      "src/a.ts",
      12,
    );
    expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
      2,
      "acme/widgets",
      7,
      expect.stringContaining("**[NIT]**"),
      "src/b.ts",
      undefined,
    );
    expect(result).toEqual(
      new Map([
        ["f1", 1001],
        ["f2", 1002],
      ]),
    );
  });

  it("skips mapping a finding whose comment creation returns a falsy id", async () => {
    githubClient.createPRReviewComment.mockResolvedValueOnce(0);
    const findings = [makeFinding({ id: "f1" })];

    const result = await svc.postReviewFindings("acme/widgets", 7, findings, "approved");

    expect(result.has("f1")).toBe(false);
  });

  it("submits an APPROVE review when verdict is 'approved'", async () => {
    await svc.postReviewFindings("acme/widgets", 7, [], "approved");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/widgets",
      7,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("submits a REQUEST_CHANGES review when verdict is not 'approved'", async () => {
    await svc.postReviewFindings("acme/widgets", 7, [], "changes_requested");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/widgets",
      7,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });

  it("includes the finding count in the review summary and logs the result", async () => {
    const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2" })];
    githubClient.createPRReviewComment.mockResolvedValue(1);

    await svc.postReviewFindings("acme/widgets", 7, findings, "approved");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/widgets",
      7,
      expect.stringContaining("2 finding(s) posted"),
      "APPROVE",
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "acme/widgets",
        prNumber: 7,
        findingsCount: 2,
        verdict: "approved",
        mappedComments: 2,
      }),
      "Posted review findings as PR review comments",
    );
  });

  it("returns an empty map and still submits a review when there are no findings", async () => {
    const result = await svc.postReviewFindings("acme/widgets", 7, [], "approved");

    expect(result.size).toBe(0);
    expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
    expect(githubClient.submitPRReview).toHaveBeenCalledTimes(1);
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  let githubClient: ReturnType<typeof buildGithubClient>;
  let logger: ReturnType<typeof buildLogger>;
  let svc: GitHubSyncService;

  beforeEach(() => {
    githubClient = buildGithubClient();
    logger = buildLogger();
    svc = new GitHubSyncService(githubClient as never, logger as never);
  });

  it("posts a comment listing files changed inline when at or below the collapse threshold", async () => {
    const report = makeExecutionReport({ filesChanged: ["src/a.ts", "src/b.ts"] });

    await svc.postExecutionReportUpdate("acme/widgets", 7, report);

    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("Files changed (2)");
    expect(body).not.toContain("<details>");
    expect(body).toContain("`src/a.ts`");
    expect(body).toContain(":white_check_mark: **Lint**");
    expect(body).toContain(":x: **Tests**");
    expect(body).toContain("Score: 75%");
  });

  it("collapses the files-changed section behind <details> above the threshold", async () => {
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);
    const report = makeExecutionReport({ filesChanged: manyFiles });

    await svc.postExecutionReportUpdate("acme/widgets", 7, report);

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
    expect(body).toContain("</details>");
  });

  it("omits the files-changed section entirely when no files changed", async () => {
    const report = makeExecutionReport({ filesChanged: [] });

    await svc.postExecutionReportUpdate("acme/widgets", 7, report);

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).not.toContain("Files changed");
    expect(body).not.toContain("<details>");
  });

  it("includes a Notes section only when notes are present", async () => {
    const withNotes = makeExecutionReport({ notes: ["Watch out for X"] });
    await svc.postExecutionReportUpdate("acme/widgets", 7, withNotes);
    expect(githubClient.commentOnPR.mock.calls[0][2] as string).toContain("### Notes");

    githubClient.commentOnPR.mockClear();
    const withoutNotes = makeExecutionReport({ notes: [] });
    await svc.postExecutionReportUpdate("acme/widgets", 7, withoutNotes);
    expect(githubClient.commentOnPR.mock.calls[0][2] as string).not.toContain("### Notes");
  });

  it("renders the skip icon for a check that is neither pass nor fail", async () => {
    const report = makeExecutionReport({
      checks: {
        lint: { status: "skip", details: "not run" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
    });

    await svc.postExecutionReportUpdate("acme/widgets", 7, report);

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain(":heavy_minus_sign: **Lint**");
  });

  it("logs the update with score and file count", async () => {
    const report = makeExecutionReport({ executionVersion: 3, score: 0.5 });

    await svc.postExecutionReportUpdate("acme/widgets", 7, report);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "acme/widgets",
        prNumber: 7,
        executionVersion: 3,
        score: 0.5,
        filesChanged: report.filesChanged.length,
      }),
      "Posted execution report update to PR",
    );
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  let githubClient: ReturnType<typeof buildGithubClient>;
  let logger: ReturnType<typeof buildLogger>;
  let svc: GitHubSyncService;

  beforeEach(() => {
    githubClient = buildGithubClient();
    logger = buildLogger();
    svc = new GitHubSyncService(githubClient as never, logger as never);
  });

  function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
    return {
      findingId: "f1",
      status: "accepted",
      action: "Added a null check.",
      rationale: "Prevents the crash.",
      ...overrides,
    };
  }

  it("replies to each mapped review comment and posts a summary table", async () => {
    const resolutions = [
      makeResolution({ findingId: "f1", status: "accepted" }),
      makeResolution({ findingId: "f2", status: "rejected", action: "No change", rationale: "Not a real bug" }),
    ];
    const commentMap = { f1: 1001, f2: 1002 };

    await svc.postRemediationResolutions("acme/widgets", 7, resolutions, commentMap);

    expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(2);
    expect(githubClient.replyToReviewComment).toHaveBeenNthCalledWith(
      1,
      "acme/widgets",
      7,
      1001,
      expect.stringContaining(":white_check_mark: **accepted**"),
    );
    expect(githubClient.replyToReviewComment).toHaveBeenNthCalledWith(
      2,
      "acme/widgets",
      7,
      1002,
      expect.stringContaining(":no_entry_sign: **rejected**"),
    );

    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summary).toContain("## AI Remediation Summary");
    expect(summary).toContain("f1");
    expect(summary).toContain("f2");
  });

  it("skips replying for resolutions with no mapped GitHub comment id", async () => {
    const resolutions = [makeResolution({ findingId: "unmapped" })];

    await svc.postRemediationResolutions("acme/widgets", 7, resolutions, {});

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    // The summary comment is still posted.
    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
  });

  it("uses the grey-question icon for an unrecognized status", async () => {
    const resolutions = [
      makeResolution({ findingId: "f1", status: "partially_addressed" }),
    ];
    // Force an unrecognized status via an unchecked cast to exercise the fallback icon branch.
    (resolutions[0] as { status: string }).status = "unknown_status";

    await svc.postRemediationResolutions("acme/widgets", 7, resolutions, { f1: 55 });

    const replyBody = githubClient.replyToReviewComment.mock.calls[0][3] as string;
    expect(replyBody).toContain(":grey_question:");
    const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summary).toContain(":grey_question:");
  });

  it("logs the resolution count and how many replies were sent", async () => {
    const resolutions = [makeResolution({ findingId: "f1" }), makeResolution({ findingId: "f2" })];
    const commentMap = { f1: 1001 };

    await svc.postRemediationResolutions("acme/widgets", 7, resolutions, commentMap);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "acme/widgets",
        prNumber: 7,
        resolutionCount: 2,
        repliedTo: 1,
      }),
      "Posted remediation resolutions to PR",
    );
  });

  it("handles an empty resolutions array by posting only the (empty) summary table", async () => {
    await svc.postRemediationResolutions("acme/widgets", 7, [], {});

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summary).toContain("| Finding | Status | Action | Rationale |");
  });
});
