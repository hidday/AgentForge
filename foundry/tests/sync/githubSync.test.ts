import { describe, it, expect, vi, beforeEach } from "vitest";
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
    branchName: "ai/lin-1",
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

describe("GitHubSyncService.syncState", () => {
  let logger: ReturnType<typeof makeLogger>;
  let githubClient: ReturnType<typeof makeGithubClient>;
  let svc: GitHubSyncService;

  beforeEach(() => {
    logger = makeLogger();
    githubClient = makeGithubClient();
    svc = new GitHubSyncService(githubClient as never, logger as never);
  });

  it("does nothing when the run has no PR number", async () => {
    await svc.syncState(makeRun({ prNumber: null, state: RunState.ReadyForHumanReview }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when the run reaches ReadyForHumanReview", async () => {
    await svc.syncState(makeRun({ prNumber: 42, state: RunState.ReadyForHumanReview }));

    expect(githubClient.markPRReady).toHaveBeenCalledWith("owner/repo", 42);
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "owner/repo",
      42,
      "All AI checks passed. Ready for human review.",
    );
  });

  it("does not mark the PR ready for a non-terminal state", async () => {
    await svc.syncState(makeRun({ prNumber: 42, state: RunState.Implementing }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
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

  function makeFinding(overrides: Partial<Finding> = {}): Finding {
    return {
      id: "f1",
      severity: "blocker",
      type: "bug",
      title: "Missing null check",
      details: "This could throw.",
      file: "src/a.ts",
      lineHint: 10,
      ...overrides,
    };
  }

  it("posts one review comment per finding and maps finding id to comment id", async () => {
    githubClient.createPRReviewComment
      .mockResolvedValueOnce(101)
      .mockResolvedValueOnce(102);

    const commentMap = await svc.postReviewFindings(
      "owner/repo",
      42,
      [makeFinding({ id: "f1" }), makeFinding({ id: "f2" })],
      "changes_requested",
    );

    expect(commentMap.get("f1")).toBe(101);
    expect(commentMap.get("f2")).toBe(102);
    expect(githubClient.createPRReviewComment).toHaveBeenCalledWith(
      "owner/repo",
      42,
      expect.stringContaining("[BLOCKER]"),
      "src/a.ts",
      10,
    );
  });

  it("does not map a finding when the comment id is falsy (e.g. 0, skipped)", async () => {
    githubClient.createPRReviewComment.mockResolvedValueOnce(0);

    const commentMap = await svc.postReviewFindings(
      "owner/repo",
      42,
      [makeFinding({ id: "f1" })],
      "approved",
    );

    expect(commentMap.has("f1")).toBe(false);
  });

  it("submits an APPROVE review when verdict is 'approved'", async () => {
    await svc.postReviewFindings("owner/repo", 42, [], "approved");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "owner/repo",
      42,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("submits a REQUEST_CHANGES review for any non-'approved' verdict", async () => {
    await svc.postReviewFindings("owner/repo", 42, [], "changes_requested");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "owner/repo",
      42,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
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

  function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
    return {
      executionVersion: 1,
      score: 0.87,
      scoreRationale: "All checks passed cleanly.",
      summary: "Implemented the feature.",
      checks: {
        lint: { status: "pass", details: "no issues" },
        typecheck: { status: "pass", details: "no errors" },
        tests: { status: "fail", details: "1 test failed" },
      },
      filesChanged: ["src/a.ts"],
      notes: ["Consider adding more tests."],
      prDraftCreated: true,
      ...overrides,
    };
  }

  it("posts a comment containing the score, checks, and a short files-changed list", async () => {
    await svc.postExecutionReportUpdate("owner/repo", 42, makeReport());

    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    const [repo, prNumber, body] = githubClient.commentOnPR.mock.calls[0] as [
      string,
      number,
      string,
    ];
    expect(repo).toBe("owner/repo");
    expect(prNumber).toBe(42);
    expect(body).toContain("Score: 87%");
    expect(body).toContain(":white_check_mark: **Lint**");
    expect(body).toContain(":x: **Tests**");
    expect(body).toContain("### Files changed (1)");
    expect(body).toContain("src/a.ts");
    expect(body).toContain("### Notes");
    expect(body).toContain("Consider adding more tests.");
  });

  it("collapses the files-changed section into a <details> block above the threshold", async () => {
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);
    await svc.postExecutionReportUpdate(
      "owner/repo",
      42,
      makeReport({ filesChanged: manyFiles }),
    );

    const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });

  it("omits the files and notes sections entirely when both are empty", async () => {
    await svc.postExecutionReportUpdate(
      "owner/repo",
      42,
      makeReport({ filesChanged: [], notes: [] }),
    );

    const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
    expect(body).not.toContain("Files changed");
    expect(body).not.toContain("### Notes");
  });

  it("renders a neutral icon for a 'skipped' check status", async () => {
    await svc.postExecutionReportUpdate(
      "owner/repo",
      42,
      makeReport({
        checks: {
          lint: { status: "skipped", details: "n/a" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      }),
    );

    const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
    expect(body).toContain(":heavy_minus_sign: **Lint**");
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

  function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
    return {
      findingId: "f1",
      status: "accepted",
      action: "Added a null check.",
      rationale: "Prevents a crash.",
      ...overrides,
    } as ResolutionItem;
  }

  it("replies on the mapped GitHub comment for each resolved finding and posts a summary table", async () => {
    await svc.postRemediationResolutions(
      "owner/repo",
      42,
      [makeResolution({ findingId: "f1", status: "accepted" })],
      { f1: 101 },
    );

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "owner/repo",
      42,
      101,
      expect.stringContaining("accepted"),
    );
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "owner/repo",
      42,
      expect.stringContaining("AI Remediation Summary"),
    );
  });

  it("skips replying when a finding has no mapped GitHub comment id", async () => {
    await svc.postRemediationResolutions(
      "owner/repo",
      42,
      [makeResolution({ findingId: "unmapped" })],
      {},
    );

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
  });

  it("uses a fallback icon for an unrecognized resolution status", async () => {
    await svc.postRemediationResolutions(
      "owner/repo",
      42,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [makeResolution({ findingId: "f1", status: "weird_status" as any })],
      { f1: 101 },
    );

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "owner/repo",
      42,
      101,
      expect.stringContaining(":grey_question:"),
    );
  });
});
