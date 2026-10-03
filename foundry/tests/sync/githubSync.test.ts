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
    repo: "owner/repo",
    branchName: "ai/run-1",
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

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "blocker",
    type: "bug",
    file: "src/a.ts",
    title: "Null check missing",
    details: "This may throw",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "fail", details: "1 failing" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Mostly good",
    ...overrides,
  };
}

describe("GitHubSyncService.syncState", () => {
  it("does nothing when the run has no PR number yet", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.syncState(makeRun({ prNumber: null }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when the run is ReadyForHumanReview", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const run = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42, repo: "owner/repo" });

    await service.syncState(run);

    expect(githubClient.markPRReady).toHaveBeenCalledWith("owner/repo", 42);
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "owner/repo",
      42,
      "All AI checks passed. Ready for human review.",
    );
  });

  it("is a no-op (idempotent) for a run with a PR number but a different state", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const run = makeRun({ state: RunState.Implementing, prNumber: 42 });

    await service.syncState(run);

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  it("posts each finding as a review comment and maps finding id -> comment id", async () => {
    const githubClient = makeGithubClient();
    githubClient.createPRReviewComment
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(501);
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const findings = [
      makeFinding({ id: "f1", severity: "blocker", file: "src/a.ts", lineHint: 10 }),
      makeFinding({ id: "f2", severity: "nit", file: "src/b.ts" }),
    ];

    const result = await service.postReviewFindings("owner/repo", 42, findings, "changes_requested");

    expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
      1,
      "owner/repo",
      42,
      expect.stringContaining("[BLOCKER]") as unknown as string,
      "src/a.ts",
      10,
    );
    expect(result).toEqual(
      new Map([
        ["f1", 500],
        ["f2", 501],
      ]),
    );
  });

  it("omits a finding from the map when createPRReviewComment returns a falsy id (e.g. 0)", async () => {
    const githubClient = makeGithubClient();
    githubClient.createPRReviewComment.mockResolvedValue(0);
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const result = await service.postReviewFindings(
      "owner/repo",
      42,
      [makeFinding({ id: "f1" })],
      "approved",
    );

    expect(result.size).toBe(0);
  });

  it("submits an APPROVE review when verdict is 'approved'", async () => {
    const githubClient = makeGithubClient();
    githubClient.createPRReviewComment.mockResolvedValue(1);
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postReviewFindings("owner/repo", 42, [makeFinding()], "approved");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "owner/repo",
      42,
      expect.stringContaining("Approved") as unknown as string,
      "APPROVE",
    );
  });

  it("submits a REQUEST_CHANGES review for any non-'approved' verdict", async () => {
    const githubClient = makeGithubClient();
    githubClient.createPRReviewComment.mockResolvedValue(1);
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postReviewFindings("owner/repo", 42, [makeFinding()], "changes_requested");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "owner/repo",
      42,
      expect.stringContaining("Changes Requested") as unknown as string,
      "REQUEST_CHANGES",
    );
  });

  it("submits a review with no inline comments when findings is empty", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const result = await service.postReviewFindings("owner/repo", 42, [], "approved");

    expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "owner/repo",
      42,
      expect.stringContaining("0 finding(s)") as unknown as string,
      "APPROVE",
    );
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  it("posts a comment including score percentage and check rows", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const report = makeExecutionReport({ score: 0.8 });

    await service.postExecutionReportUpdate("owner/repo", 42, report);

    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("Score: 80%");
    expect(body).toContain(":white_check_mark: **Lint**");
    expect(body).toContain(":x: **Tests**");
  });

  it("collapses files-changed into a <details> block when above the threshold", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);
    const report = makeExecutionReport({ filesChanged: manyFiles });

    await service.postExecutionReportUpdate("owner/repo", 42, report);

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });

  it("lists files-changed inline when at or below the threshold", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const report = makeExecutionReport({ filesChanged: ["src/a.ts", "src/b.ts"] });

    await service.postExecutionReportUpdate("owner/repo", 42, report);

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).not.toContain("<details>");
    expect(body).toContain("Files changed (2)");
  });

  it("omits the files section entirely when filesChanged is empty", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const report = makeExecutionReport({ filesChanged: [] });

    await service.postExecutionReportUpdate("owner/repo", 42, report);

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).not.toContain("Files changed");
  });

  it("includes a Notes section only when notes are present", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate(
      "owner/repo",
      42,
      makeExecutionReport({ notes: ["Watch out for X"] }),
    );
    expect(githubClient.commentOnPR.mock.calls[0][2] as string).toContain("### Notes");

    githubClient.commentOnPR.mockClear();
    await service.postExecutionReportUpdate("owner/repo", 42, makeExecutionReport({ notes: [] }));
    expect(githubClient.commentOnPR.mock.calls[0][2] as string).not.toContain("### Notes");
  });

  it("renders a skipped check with the heavy-minus icon", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const report = makeExecutionReport({
      checks: {
        lint: { status: "skip", details: "n/a" },
        typecheck: { status: "pass", details: "clean" },
        tests: { status: "pass", details: "clean" },
      },
    });

    await service.postExecutionReportUpdate("owner/repo", 42, report);

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain(":heavy_minus_sign: **Lint**");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
    return {
      findingId: "f1",
      status: "accepted",
      action: "Fixed the null check",
      rationale: "Added a guard clause",
      ...overrides,
    };
  }

  it("replies to the mapped review comment for each resolution with a comment id", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const resolutions = [makeResolution({ findingId: "f1", status: "accepted" })];

    await service.postRemediationResolutions("owner/repo", 42, resolutions, { f1: 500 });

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "owner/repo",
      42,
      500,
      expect.stringContaining(":white_check_mark:") as unknown as string,
    );
  });

  it("skips replying when a resolution has no mapped comment id", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const resolutions = [makeResolution({ findingId: "f-unmapped" })];

    await service.postRemediationResolutions("owner/repo", 42, resolutions, {});

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    // Still posts the overall summary comment.
    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
  });

  it("uses the correct icon per resolution status in the summary table", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const resolutions = [
      makeResolution({ findingId: "f1", status: "accepted" }),
      makeResolution({ findingId: "f2", status: "rejected" }),
      makeResolution({ findingId: "f3", status: "partially_addressed" }),
    ];

    await service.postRemediationResolutions("owner/repo", 42, resolutions, {});

    const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summaryBody).toContain(":white_check_mark:");
    expect(summaryBody).toContain(":no_entry_sign:");
    expect(summaryBody).toContain(":warning:");
  });

  it("falls back to a question-mark icon for an unrecognized resolution status", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    // Cast past the ResolutionStatus union to exercise the `?? ":grey_question:"`
    // fallback for a status the icon map doesn't recognize.
    const resolutions = [
      makeResolution({ findingId: "f1", status: "mystery" as ResolutionItem["status"] }),
    ];

    await service.postRemediationResolutions("owner/repo", 42, resolutions, { f1: 500 });

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "owner/repo",
      42,
      500,
      expect.stringContaining(":grey_question:") as unknown as string,
    );
    const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summaryBody).toContain(":grey_question:");
  });

  it("posts a summary comment with one row per resolution, replacing underscores with spaces", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const resolutions = [makeResolution({ findingId: "f1", status: "partially_addressed" })];

    await service.postRemediationResolutions("owner/repo", 42, resolutions, {});

    const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summaryBody).toContain("partially addressed");
    expect(summaryBody).not.toContain("partially_addressed");
  });
});
