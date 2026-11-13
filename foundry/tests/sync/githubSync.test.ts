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
    linearIssueId: "lin-1",
    linearIssueIdentifier: "PRY-1",
    linearIssueDescription: null,
    linearIssueTitle: "Test issue",
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: "ai/pry-1",
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

function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
  return {
    findingId: "f1",
    status: "accepted",
    action: "Added null guard",
    rationale: "Real bug",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 2,
    summary: "Post-remediation state.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "all tests pass" },
    },
    notes: ["note 1"],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks good",
    ...overrides,
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
    createPRReviewComment: vi.fn().mockResolvedValue(555),
    submitPRReview: vi.fn().mockResolvedValue(undefined),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
  };
}

describe("GitHubSyncService.syncState", () => {
  let logger: ReturnType<typeof makeLogger>;
  let githubClient: ReturnType<typeof makeGithubClient>;
  let svc: GitHubSyncService;

  beforeEach(() => {
    logger = makeLogger();
    githubClient = makeGithubClient();
    svc = new GitHubSyncService(githubClient as never, logger as never);
  });

  it("does nothing when the run has no prNumber", async () => {
    const run = makeRun({ prNumber: null });
    await svc.syncState(run);

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });

  it("does nothing when the run has a prNumber but is not in ReadyForHumanReview", async () => {
    const run = makeRun({ state: RunState.Implementing });
    await svc.syncState(run);

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when ReadyForHumanReview with a prNumber", async () => {
    const run = makeRun();
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
});

describe("GitHubSyncService.postReviewFindings", () => {
  let logger: ReturnType<typeof makeLogger>;
  let githubClient: ReturnType<typeof makeGithubClient>;
  let svc: GitHubSyncService;

  beforeEach(() => {
    logger = makeLogger();
    githubClient = makeGithubClient();
    svc = new GitHubSyncService(githubClient as never, logger as never);
  });

  it("creates one review comment per finding and maps findingId -> commentId", async () => {
    githubClient.createPRReviewComment
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(101);
    const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2", severity: "nit" })];

    const map = await svc.postReviewFindings("acme/widgets", 42, findings, "changes_requested");

    expect(githubClient.createPRReviewComment).toHaveBeenCalledTimes(2);
    expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
      1,
      "acme/widgets",
      42,
      expect.stringContaining("**[IMPORTANT]** Missing null check"),
      "src/foo.ts",
      12,
    );
    expect(map.get("f1")).toBe(100);
    expect(map.get("f2")).toBe(101);
  });

  it("omits a finding from the map when createPRReviewComment returns falsy", async () => {
    githubClient.createPRReviewComment.mockResolvedValueOnce(0);
    const findings = [makeFinding({ id: "f1" })];

    const map = await svc.postReviewFindings("acme/widgets", 42, findings, "changes_requested");

    expect(map.has("f1")).toBe(false);
  });

  it("submits an APPROVE review when verdict is approved", async () => {
    await svc.postReviewFindings("acme/widgets", 42, [], "approved");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/widgets",
      42,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("submits a REQUEST_CHANGES review for any non-approved verdict", async () => {
    await svc.postReviewFindings("acme/widgets", 42, [], "changes_requested");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/widgets",
      42,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });

  it("logs findingsCount, verdict and mappedComments size", async () => {
    githubClient.createPRReviewComment.mockResolvedValueOnce(100);
    await svc.postReviewFindings("acme/widgets", 42, [makeFinding()], "approved");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "acme/widgets",
        prNumber: 42,
        findingsCount: 1,
        verdict: "approved",
        mappedComments: 1,
      }),
      "Posted review findings as PR review comments",
    );
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  let logger: ReturnType<typeof makeLogger>;
  let githubClient: ReturnType<typeof makeGithubClient>;
  let svc: GitHubSyncService;

  beforeEach(() => {
    logger = makeLogger();
    githubClient = makeGithubClient();
    svc = new GitHubSyncService(githubClient as never, logger as never);
  });

  it("renders a short files-changed section (<= 8 files) without <details>", async () => {
    const report = makeExecutionReport({ filesChanged: ["a.ts", "b.ts"] });
    await svc.postExecutionReportUpdate("acme/widgets", 42, report);

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("### Files changed (2)");
    expect(body).not.toContain("<details>");
    expect(body).toContain("- `a.ts`");
  });

  it("collapses the files-changed section into <details> when > 8 files", async () => {
    const files = Array.from({ length: 9 }, (_, i) => `file${String(i)}.ts`);
    const report = makeExecutionReport({ filesChanged: files });
    await svc.postExecutionReportUpdate("acme/widgets", 42, report);

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
    expect(body).toContain("</details>");
  });

  it("omits the files-changed section entirely when there are no files", async () => {
    const report = makeExecutionReport({ filesChanged: [] });
    await svc.postExecutionReportUpdate("acme/widgets", 42, report);

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).not.toContain("Files changed");
  });

  it("includes a Notes section when notes is non-empty, omits it otherwise", async () => {
    const withNotes = makeExecutionReport({ notes: ["Added zod dependency"] });
    await svc.postExecutionReportUpdate("acme/widgets", 42, withNotes);
    let body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("### Notes");
    expect(body).toContain("- Added zod dependency");

    githubClient.commentOnPR.mockClear();
    const withoutNotes = makeExecutionReport({ notes: [] });
    await svc.postExecutionReportUpdate("acme/widgets", 42, withoutNotes);
    body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).not.toContain("### Notes");
  });

  it("renders the correct check icon for pass, fail and skip", async () => {
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "clean" },
        typecheck: { status: "fail", details: "2 errors" },
        tests: { status: "skip", details: "not run" },
      },
    });
    await svc.postExecutionReportUpdate("acme/widgets", 42, report);

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain(":white_check_mark: **Lint** -- clean");
    expect(body).toContain(":x: **Typecheck** -- 2 errors");
    expect(body).toContain(":heavy_minus_sign: **Tests** -- not run");
  });

  it("formats the score as a rounded percentage and includes the execution version", async () => {
    const report = makeExecutionReport({ executionVersion: 3, score: 0.783 });
    await svc.postExecutionReportUpdate("acme/widgets", 42, report);

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("## AI Execution Report (v3) -- Score: 78%");
  });

  it("logs the execution report metadata", async () => {
    const report = makeExecutionReport({ executionVersion: 2, score: 0.9 });
    await svc.postExecutionReportUpdate("acme/widgets", 42, report);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "acme/widgets",
        prNumber: 42,
        executionVersion: 2,
        score: 0.9,
        filesChanged: report.filesChanged.length,
      }),
      "Posted execution report update to PR",
    );
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  let logger: ReturnType<typeof makeLogger>;
  let githubClient: ReturnType<typeof makeGithubClient>;
  let svc: GitHubSyncService;

  beforeEach(() => {
    logger = makeLogger();
    githubClient = makeGithubClient();
    svc = new GitHubSyncService(githubClient as never, logger as never);
  });

  it("replies to the mapped PR comment when a commentMap entry exists for the finding", async () => {
    const resolutions = [makeResolution({ findingId: "f1", status: "accepted" })];
    await svc.postRemediationResolutions("acme/widgets", 42, resolutions, { f1: 555 });

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "acme/widgets",
      42,
      555,
      expect.stringContaining(":white_check_mark: **accepted**"),
    );
  });

  it("does not reply when there is no commentMap entry for the finding", async () => {
    const resolutions = [makeResolution({ findingId: "f-unmapped" })];
    await svc.postRemediationResolutions("acme/widgets", 42, resolutions, {});

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
  });

  it("uses the correct status icon for rejected and partially_addressed, and falls back for unknown status", async () => {
    const resolutions = [
      makeResolution({ findingId: "f1", status: "rejected" }),
      makeResolution({ findingId: "f2", status: "partially_addressed" }),
      makeResolution({ findingId: "f3", status: "something_else" as never }),
    ];
    await svc.postRemediationResolutions("acme/widgets", 42, resolutions, {
      f1: 1,
      f2: 2,
      f3: 3,
    });

    const calls = githubClient.replyToReviewComment.mock.calls as unknown[][];
    expect(calls[0][3] as string).toContain(":no_entry_sign: **rejected**");
    expect(calls[1][3] as string).toContain(":warning: **partially addressed**");
    expect(calls[2][3] as string).toContain(":grey_question: **something else**");
  });

  it("posts a markdown summary table of all resolutions", async () => {
    const resolutions = [
      makeResolution({ findingId: "f1", status: "accepted", action: "Fixed it" }),
      makeResolution({ findingId: "f2", status: "rejected", action: "No changes made." }),
    ];
    await svc.postRemediationResolutions("acme/widgets", 42, resolutions, { f1: 1 });

    const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summaryBody).toContain("## AI Remediation Summary");
    expect(summaryBody).toContain("| Finding | Status | Action | Rationale |");
    expect(summaryBody).toContain("**f1**");
    expect(summaryBody).toContain("Fixed it");
    expect(summaryBody).toContain("**f2**");
  });

  it("logs resolutionCount and repliedTo count", async () => {
    const resolutions = [
      makeResolution({ findingId: "f1" }),
      makeResolution({ findingId: "f2" }),
    ];
    await svc.postRemediationResolutions("acme/widgets", 42, resolutions, { f1: 1 });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "acme/widgets",
        prNumber: 42,
        resolutionCount: 2,
        repliedTo: 1,
      }),
      "Posted remediation resolutions to PR",
    );
  });
});
