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
    repo: "org/repo",
    branchName: "ai/issue-1",
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

function makeGitHubClient() {
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

describe("GitHubSyncService.syncState", () => {
  let githubClient: ReturnType<typeof makeGitHubClient>;
  let logger: ReturnType<typeof makeLogger>;
  let service: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGitHubClient();
    logger = makeLogger();
    service = new GitHubSyncService(githubClient as never, logger as never);
  });

  it("does nothing when the run has no PR number", async () => {
    const run = makeRun({ prNumber: null, state: RunState.ReadyForHumanReview });

    await service.syncState(run);

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });

  it("does nothing when the run is not in ReadyForHumanReview", async () => {
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });

  it("marks the PR ready and posts a comment when ready for human review", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 99 });

    await service.syncState(run);

    expect(githubClient.markPRReady).toHaveBeenCalledWith("org/repo", 99);
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "org/repo",
      99,
      "All AI checks passed. Ready for human review.",
    );
    expect(logger.debug).toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  let githubClient: ReturnType<typeof makeGitHubClient>;
  let service: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGitHubClient();
    service = new GitHubSyncService(githubClient as never, makeLogger() as never);
  });

  function makeFinding(overrides: Partial<Finding> = {}): Finding {
    return {
      id: "f1",
      severity: "blocker",
      type: "bug",
      file: "src/x.ts",
      title: "Null deref",
      details: "This may throw",
      ...overrides,
    };
  }

  it("posts one review comment per finding and maps finding id to comment id", async () => {
    githubClient.createPRReviewComment
      .mockResolvedValueOnce(1001)
      .mockResolvedValueOnce(1002);

    const findings = [
      makeFinding({ id: "f1", severity: "blocker" }),
      makeFinding({ id: "f2", severity: "nit", lineHint: 10 }),
    ];

    const map = await service.postReviewFindings("org/repo", 5, findings, "changes_requested");

    expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
      1,
      "org/repo",
      5,
      "**[BLOCKER]** Null deref\n\nThis may throw",
      "src/x.ts",
      undefined,
    );
    expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
      2,
      "org/repo",
      5,
      expect.stringContaining("**[NIT]**"),
      "src/x.ts",
      10,
    );
    expect(map.get("f1")).toBe(1001);
    expect(map.get("f2")).toBe(1002);
  });

  it("does not map a finding whose comment id is falsy (0, skipped)", async () => {
    githubClient.createPRReviewComment.mockResolvedValueOnce(0);

    const map = await service.postReviewFindings(
      "org/repo",
      5,
      [makeFinding({ id: "f1" })],
      "changes_requested",
    );

    expect(map.has("f1")).toBe(false);
  });

  it("submits an APPROVE review when the verdict is approved", async () => {
    githubClient.createPRReviewComment.mockResolvedValue(1001);

    await service.postReviewFindings("org/repo", 5, [makeFinding()], "approved");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      5,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("submits a REQUEST_CHANGES review for any non-approved verdict", async () => {
    githubClient.createPRReviewComment.mockResolvedValue(1001);

    await service.postReviewFindings("org/repo", 5, [makeFinding()], "changes_requested");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      5,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });

  it("submits a review with zero findings", async () => {
    const map = await service.postReviewFindings("org/repo", 5, [], "approved");

    expect(map.size).toBe(0);
    expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      5,
      expect.stringContaining("0 finding(s)"),
      "APPROVE",
    );
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  let githubClient: ReturnType<typeof makeGitHubClient>;
  let service: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGitHubClient();
    service = new GitHubSyncService(githubClient as never, makeLogger() as never);
  });

  function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
    return {
      executionVersion: 1,
      summary: "Implemented the feature",
      filesChanged: ["src/a.ts", "src/b.ts"],
      checks: {
        lint: { status: "pass", details: "0 problems" },
        typecheck: { status: "pass", details: "no errors" },
        tests: { status: "fail", details: "1 failing" },
      },
      notes: ["Watch out for X"],
      prDraftCreated: true,
      score: 0.85,
      scoreRationale: "Solid implementation",
      ...overrides,
    };
  }

  it("posts a comment containing score, checks, files, and notes", async () => {
    const report = makeReport();

    await service.postExecutionReportUpdate("org/repo", 5, report);

    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    const [repo, prNumber, body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
    expect(repo).toBe("org/repo");
    expect(prNumber).toBe(5);
    expect(body).toContain("Score: 85%");
    expect(body).toContain(":white_check_mark: **Lint**");
    expect(body).toContain(":x: **Tests**");
    expect(body).toContain("### Files changed (2)");
    expect(body).toContain("`src/a.ts`");
    expect(body).toContain("### Notes");
    expect(body).toContain("- Watch out for X");
  });

  it("omits the files section when there are no changed files", async () => {
    const report = makeReport({ filesChanged: [] });

    await service.postExecutionReportUpdate("org/repo", 5, report);

    const body = githubClient.commentOnPR.mock.calls[0]?.[2] as string;
    expect(body).not.toContain("### Files changed");
  });

  it("omits the notes section when there are no notes", async () => {
    const report = makeReport({ notes: [] });

    await service.postExecutionReportUpdate("org/repo", 5, report);

    const body = githubClient.commentOnPR.mock.calls[0]?.[2] as string;
    expect(body).not.toContain("### Notes");
  });

  it("collapses the files list into a <details> block above the threshold", async () => {
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);
    const report = makeReport({ filesChanged: manyFiles });

    await service.postExecutionReportUpdate("org/repo", 5, report);

    const body = githubClient.commentOnPR.mock.calls[0]?.[2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });

  it("renders a skip icon for skipped checks", async () => {
    const report = makeReport({
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "skip", details: "no tests changed" },
      },
    });

    await service.postExecutionReportUpdate("org/repo", 5, report);

    const body = githubClient.commentOnPR.mock.calls[0]?.[2] as string;
    expect(body).toContain(":heavy_minus_sign: **Tests**");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  let githubClient: ReturnType<typeof makeGitHubClient>;
  let service: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGitHubClient();
    service = new GitHubSyncService(githubClient as never, makeLogger() as never);
  });

  function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
    return {
      findingId: "f1",
      status: "accepted",
      action: "Fixed the null check",
      rationale: "Prevents a crash",
      ...overrides,
    };
  }

  it("replies to each mapped finding's review comment", async () => {
    const resolutions = [
      makeResolution({ findingId: "f1", status: "accepted" }),
      makeResolution({ findingId: "f2", status: "rejected" }),
    ];
    const commentMap = { f1: 1001, f2: 1002 };

    await service.postRemediationResolutions("org/repo", 5, resolutions, commentMap);

    expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(2);
    expect(githubClient.replyToReviewComment).toHaveBeenNthCalledWith(
      1,
      "org/repo",
      5,
      1001,
      expect.stringContaining(":white_check_mark: **accepted**"),
    );
    expect(githubClient.replyToReviewComment).toHaveBeenNthCalledWith(
      2,
      "org/repo",
      5,
      1002,
      expect.stringContaining(":no_entry_sign: **rejected**"),
    );
  });

  it("skips replying for a resolution with no mapped GitHub comment id", async () => {
    const resolutions = [makeResolution({ findingId: "f-unmapped" })];

    await service.postRemediationResolutions("org/repo", 5, resolutions, {});

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
  });

  it("posts a summary table comment covering all resolutions", async () => {
    const resolutions = [
      makeResolution({ findingId: "f1", status: "partially_addressed", action: "Partial fix" }),
    ];

    await service.postRemediationResolutions("org/repo", 5, resolutions, {});

    const summaryCall = githubClient.commentOnPR.mock.calls.find(
      (call) => typeof call[2] === "string" && call[2].includes("AI Remediation Summary"),
    ) as [string, number, string] | undefined;
    expect(summaryCall).toBeDefined();
    expect(summaryCall?.[2]).toContain(":warning: **f1**");
    expect(summaryCall?.[2]).toContain("partially addressed");
  });

  it("uses a placeholder icon for an unrecognized status", async () => {
    const resolutions = [makeResolution({ status: "unexpected_status" as ResolutionItem["status"] })];

    await service.postRemediationResolutions("org/repo", 5, resolutions, { f1: 1001 });

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "org/repo",
      5,
      1001,
      expect.stringContaining(":grey_question:"),
    );
  });
});
