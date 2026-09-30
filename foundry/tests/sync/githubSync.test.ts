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
    repo: "test-repo",
    branchName: null,
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
    verifyRepoAccess: vi.fn().mockResolvedValue(undefined),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
    createBranch: vi.fn().mockResolvedValue(undefined),
    createDraftPR: vi.fn().mockResolvedValue(1),
    commentOnPR: vi.fn().mockResolvedValue(undefined),
    getPRDiff: vi.fn().mockResolvedValue(""),
    markPRReady: vi.fn().mockResolvedValue(undefined),
    listPRComments: vi.fn().mockResolvedValue([]),
    createPRReviewComment: vi.fn().mockResolvedValue(500),
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
    lineHint: 10,
    title: "Something wrong",
    details: "Detailed explanation",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Did the work",
    filesChanged: [],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "pass", details: "clean" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks solid",
    ...overrides,
  };
}

function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
  return {
    findingId: "f1",
    status: "accepted",
    action: "Fixed the bug",
    rationale: "It was broken",
    ...overrides,
  };
}

describe("GitHubSyncService.syncState", () => {
  let githubClient: ReturnType<typeof makeGithubClient>;
  let logger: ReturnType<typeof makeLogger>;
  let svc: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGithubClient();
    logger = makeLogger();
    svc = new GitHubSyncService(githubClient as never, logger as never);
  });

  it("no-ops when the run has no prNumber", async () => {
    const run = makeRun({ prNumber: null, state: RunState.ReadyForHumanReview });
    await svc.syncState(run);

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it("marks PR ready and comments when state is ReadyForHumanReview", async () => {
    const run = makeRun({ prNumber: 42, state: RunState.ReadyForHumanReview, repo: "acme/widgets" });
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

  it("does nothing for states other than ReadyForHumanReview even with a prNumber", async () => {
    const run = makeRun({ prNumber: 42, state: RunState.Implementing });
    await svc.syncState(run);

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  let githubClient: ReturnType<typeof makeGithubClient>;
  let logger: ReturnType<typeof makeLogger>;
  let svc: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGithubClient();
    logger = makeLogger();
    svc = new GitHubSyncService(githubClient as never, logger as never);
  });

  it("posts one review comment per finding, maps ids, and submits an APPROVE review when verdict is approved", async () => {
    githubClient.createPRReviewComment
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(501);
    const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2", severity: "nit" })];

    const map = await svc.postReviewFindings("acme/widgets", 42, findings, "approved");

    expect(githubClient.createPRReviewComment).toHaveBeenCalledTimes(2);
    expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
      1,
      "acme/widgets",
      42,
      "**[IMPORTANT]** Something wrong\n\nDetailed explanation",
      "src/foo.ts",
      10,
    );
    expect(map.get("f1")).toBe(500);
    expect(map.get("f2")).toBe(501);

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/widgets",
      42,
      expect.stringContaining("AI Code Review: Approved"),
      "APPROVE",
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "acme/widgets",
        prNumber: 42,
        findingsCount: 2,
        verdict: "approved",
        mappedComments: 2,
      }),
      "Posted review findings as PR review comments",
    );
  });

  it("submits a REQUEST_CHANGES review for any non-approved verdict", async () => {
    await svc.postReviewFindings("acme/widgets", 42, [], "changes_requested");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/widgets",
      42,
      expect.stringContaining("AI Code Review: Changes Requested"),
      "REQUEST_CHANGES",
    );
  });

  it("does not map a finding whose comment id is falsy (0/undefined)", async () => {
    githubClient.createPRReviewComment.mockResolvedValueOnce(0);
    const findings = [makeFinding({ id: "f1" })];

    const map = await svc.postReviewFindings("acme/widgets", 42, findings, "approved");

    expect(map.has("f1")).toBe(false);
  });

  it("handles an empty findings array without posting inline comments", async () => {
    const map = await svc.postReviewFindings("acme/widgets", 42, [], "approved");

    expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/widgets",
      42,
      expect.stringContaining("0 finding(s) posted"),
      "APPROVE",
    );
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  let githubClient: ReturnType<typeof makeGithubClient>;
  let logger: ReturnType<typeof makeLogger>;
  let svc: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGithubClient();
    logger = makeLogger();
    svc = new GitHubSyncService(githubClient as never, logger as never);
  });

  it("renders check icons for pass, fail, and unknown statuses, and omits files/notes sections when empty", async () => {
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "fail", details: "broke" },
        tests: { status: "skip", details: "n/a" },
      },
      filesChanged: [],
      notes: [],
    });

    await svc.postExecutionReportUpdate("acme/widgets", 42, report);

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain(":white_check_mark: **Lint** -- ok");
    expect(body).toContain(":x: **Typecheck** -- broke");
    expect(body).toContain(":heavy_minus_sign: **Tests** -- n/a");
    expect(body).not.toContain("Files changed");
    expect(body).not.toContain("### Notes");
    expect(body).toContain("Score: 90%");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "acme/widgets",
        prNumber: 42,
        executionVersion: 1,
        score: 0.9,
        filesChanged: 0,
      }),
      "Posted execution report update to PR",
    );
  });

  it("renders an inline files-changed list when at or below the collapse threshold", async () => {
    const report = makeExecutionReport({
      filesChanged: ["a.ts", "b.ts"],
      notes: ["Heads up"],
    });

    await svc.postExecutionReportUpdate("acme/widgets", 42, report);

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("### Files changed (2)");
    expect(body).toContain("- `a.ts`");
    expect(body).not.toContain("<details>");
    expect(body).toContain("### Notes");
    expect(body).toContain("- Heads up");
  });

  it("collapses the files-changed list into a <details> block above the threshold", async () => {
    const files = Array.from({ length: 9 }, (_, i) => `file${String(i)}.ts`);
    const report = makeExecutionReport({ filesChanged: files });

    await svc.postExecutionReportUpdate("acme/widgets", 42, report);

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
    expect(body).toContain("</details>");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  let githubClient: ReturnType<typeof makeGithubClient>;
  let logger: ReturnType<typeof makeLogger>;
  let svc: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGithubClient();
    logger = makeLogger();
    svc = new GitHubSyncService(githubClient as never, logger as never);
  });

  it("replies to review comments that have a mapped github comment id", async () => {
    const resolutions = [makeResolution({ findingId: "f1", status: "accepted" })];
    const commentMap = { f1: 500 };

    await svc.postRemediationResolutions("acme/widgets", 42, resolutions, commentMap);

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "acme/widgets",
      42,
      500,
      expect.stringContaining(":white_check_mark: **accepted**"),
    );
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "acme/widgets",
      42,
      expect.stringContaining("## AI Remediation Summary"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ resolutionCount: 1, repliedTo: 1 }),
      "Posted remediation resolutions to PR",
    );
  });

  it("skips replying when a finding has no mapped github comment id", async () => {
    const resolutions = [makeResolution({ findingId: "unmapped" })];

    await svc.postRemediationResolutions("acme/widgets", 42, resolutions, {});

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repliedTo: 0 }),
      "Posted remediation resolutions to PR",
    );
  });

  it("falls back to a grey question icon for an unrecognized status and formats underscores as spaces", async () => {
    const resolutions = [
      { findingId: "f1", status: "weird_status", action: "did stuff", rationale: "because" } as unknown as ResolutionItem,
    ];

    await svc.postRemediationResolutions("acme/widgets", 42, resolutions, { f1: 777 });

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "acme/widgets",
      42,
      777,
      expect.stringContaining(":grey_question: **weird status**"),
    );
    const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summaryBody).toContain(":grey_question:");
    expect(summaryBody).toContain("weird status");
  });

  it("renders every resolution as a table row in the summary body", async () => {
    const resolutions = [
      makeResolution({ findingId: "f1", status: "accepted" }),
      makeResolution({ findingId: "f2", status: "rejected", action: "No change", rationale: "Not valid" }),
      makeResolution({
        findingId: "f3",
        status: "partially_addressed",
        action: "Partial fix",
        rationale: "Time constraints",
      }),
    ];

    await svc.postRemediationResolutions("acme/widgets", 42, resolutions, {});

    const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summaryBody).toContain("f1");
    expect(summaryBody).toContain("f2");
    expect(summaryBody).toContain("f3");
    expect(summaryBody).toContain(":no_entry_sign:");
    expect(summaryBody).toContain(":warning:");
  });
});
