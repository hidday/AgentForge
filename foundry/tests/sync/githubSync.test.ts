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
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: "feature/x",
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
    severity: "important",
    type: "bug",
    file: "src/a.ts",
    lineHint: 10,
    title: "Off by one",
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
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "fail", details: "1 failing" },
    },
    notes: ["Refactored helper"],
    prDraftCreated: true,
    score: 0.82,
    scoreRationale: "Mostly solid, one failing test",
    ...overrides,
  };
}

describe("GitHubSyncService.syncState", () => {
  it("does nothing when the run has no PR yet", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);

    await svc.syncState(makeRun({ prNumber: null, state: RunState.ReadyForHumanReview }));

    expect(github.markPRReady).not.toHaveBeenCalled();
    expect(github.commentOnPR).not.toHaveBeenCalled();
  });

  it("does nothing when the run has a PR but is not in ReadyForHumanReview", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);

    await svc.syncState(makeRun({ prNumber: 5, state: RunState.Implementing }));

    expect(github.markPRReady).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when the run is ReadyForHumanReview with a PR", async () => {
    const github = makeGithubClient();
    const logger = makeLogger();
    const svc = new GitHubSyncService(github as never, logger as never);

    await svc.syncState(makeRun({ prNumber: 7, state: RunState.ReadyForHumanReview }));

    expect(github.markPRReady).toHaveBeenCalledWith("acme/widgets", 7);
    expect(github.commentOnPR).toHaveBeenCalledWith(
      "acme/widgets",
      7,
      "All AI checks passed. Ready for human review.",
    );
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "acme/widgets", prNumber: 7 },
      "Marked PR ready for review",
    );
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  it("posts each finding as a review comment and maps ids by findingId", async () => {
    const github = makeGithubClient();
    github.createPRReviewComment
      .mockResolvedValueOnce(101)
      .mockResolvedValueOnce(102);
    const svc = new GitHubSyncService(github as never, makeLogger() as never);
    const findings = [
      makeFinding({ id: "f1", severity: "blocker", title: "Bug A" }),
      makeFinding({ id: "f2", severity: "nit", title: "Style B", lineHint: undefined }),
    ];

    const map = await svc.postReviewFindings("acme/widgets", 7, findings, "changes_requested");

    expect(github.createPRReviewComment).toHaveBeenNthCalledWith(
      1,
      "acme/widgets",
      7,
      "**[BLOCKER]** Bug A\n\nLoop bound is wrong",
      "src/a.ts",
      10,
    );
    expect(github.createPRReviewComment).toHaveBeenNthCalledWith(
      2,
      "acme/widgets",
      7,
      "**[NIT]** Style B\n\nLoop bound is wrong",
      "src/a.ts",
      undefined,
    );
    expect(map.get("f1")).toBe(101);
    expect(map.get("f2")).toBe(102);
  });

  it("does not map a finding when createPRReviewComment returns a falsy id (0)", async () => {
    const github = makeGithubClient();
    github.createPRReviewComment.mockResolvedValue(0);
    const svc = new GitHubSyncService(github as never, makeLogger() as never);

    const map = await svc.postReviewFindings("acme/widgets", 7, [makeFinding()], "approved");

    expect(map.size).toBe(0);
  });

  it("submits an APPROVE review with a summary when verdict is 'approved'", async () => {
    const github = makeGithubClient();
    github.createPRReviewComment.mockResolvedValue(1);
    const svc = new GitHubSyncService(github as never, makeLogger() as never);

    await svc.postReviewFindings("acme/widgets", 7, [makeFinding(), makeFinding({ id: "f2" })], "approved");

    expect(github.submitPRReview).toHaveBeenCalledWith(
      "acme/widgets",
      7,
      "AI Code Review: Approved\n\n2 finding(s) posted as inline comments.",
      "APPROVE",
    );
  });

  it("submits a REQUEST_CHANGES review with a summary for any non-'approved' verdict", async () => {
    const github = makeGithubClient();
    github.createPRReviewComment.mockResolvedValue(1);
    const svc = new GitHubSyncService(github as never, makeLogger() as never);

    await svc.postReviewFindings("acme/widgets", 7, [], "changes_requested");

    expect(github.submitPRReview).toHaveBeenCalledWith(
      "acme/widgets",
      7,
      "AI Code Review: Changes Requested\n\n0 finding(s) posted as inline comments.",
      "REQUEST_CHANGES",
    );
  });

  it("logs a summary with counts", async () => {
    const github = makeGithubClient();
    github.createPRReviewComment.mockResolvedValue(55);
    const logger = makeLogger();
    const svc = new GitHubSyncService(github as never, logger as never);

    await svc.postReviewFindings("acme/widgets", 7, [makeFinding()], "approved");

    expect(logger.info).toHaveBeenCalledWith(
      {
        repo: "acme/widgets",
        prNumber: 7,
        findingsCount: 1,
        verdict: "approved",
        mappedComments: 1,
      },
      "Posted review findings as PR review comments",
    );
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  it("posts a formatted comment with score, checks, and a short (non-collapsed) files list", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);
    const report = makeReport({ filesChanged: ["a.ts", "b.ts"] });

    await svc.postExecutionReportUpdate("acme/widgets", 7, report);

    expect(github.commentOnPR).toHaveBeenCalledOnce();
    const [repo, prNumber, body] = github.commentOnPR.mock.calls[0]!;
    expect(repo).toBe("acme/widgets");
    expect(prNumber).toBe(7);
    expect(body).toContain("## AI Execution Report (v1) -- Score: 82%");
    expect(body).toContain(":white_check_mark: **Lint** -- clean");
    expect(body).toContain(":x: **Tests** -- 1 failing");
    expect(body).toContain("### Files changed (2)");
    expect(body).not.toContain("<details>");
    expect(body).toContain("- `a.ts`");
    expect(body).toContain("### Notes");
    expect(body).toContain("- Refactored helper");
  });

  it("uses a <details> collapse for more than 8 changed files", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);
    const report = makeReport({
      filesChanged: Array.from({ length: 9 }, (_, i) => `file${String(i)}.ts`),
    });

    await svc.postExecutionReportUpdate("acme/widgets", 7, report);

    const [, , body] = github.commentOnPR.mock.calls[0]!;
    expect(body).toContain("<details>");
    expect(body).toContain("<summary><strong>Files changed (9)</strong></summary>");
  });

  it("omits the files section entirely when filesChanged is empty", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);
    const report = makeReport({ filesChanged: [] });

    await svc.postExecutionReportUpdate("acme/widgets", 7, report);

    const [, , body] = github.commentOnPR.mock.calls[0]!;
    expect(body).not.toContain("Files changed");
  });

  it("omits the Notes section entirely when notes is empty", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);
    const report = makeReport({ notes: [] });

    await svc.postExecutionReportUpdate("acme/widgets", 7, report);

    const [, , body] = github.commentOnPR.mock.calls[0]!;
    expect(body).not.toContain("### Notes");
  });

  it("renders the skip icon for a 'skip' check status", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);
    const report = makeReport({
      checks: {
        lint: { status: "skip", details: "n/a" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
    });

    await svc.postExecutionReportUpdate("acme/widgets", 7, report);

    const [, , body] = github.commentOnPR.mock.calls[0]!;
    expect(body).toContain(":heavy_minus_sign: **Lint** -- n/a");
  });

  it("logs a summary", async () => {
    const github = makeGithubClient();
    const logger = makeLogger();
    const svc = new GitHubSyncService(github as never, logger as never);
    const report = makeReport();

    await svc.postExecutionReportUpdate("acme/widgets", 7, report);

    expect(logger.info).toHaveBeenCalledWith(
      {
        repo: "acme/widgets",
        prNumber: 7,
        executionVersion: report.executionVersion,
        score: report.score,
        filesChanged: report.filesChanged.length,
      },
      "Posted execution report update to PR",
    );
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
    return {
      findingId: "f1",
      status: "accepted",
      action: "Fixed the loop",
      rationale: "It was indeed off by one",
      ...overrides,
    };
  }

  it("replies to each finding's GitHub comment when a mapping exists", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);
    const resolutions = [makeResolution({ findingId: "f1", status: "accepted" })];

    await svc.postRemediationResolutions("acme/widgets", 7, resolutions, { f1: 101 });

    expect(github.replyToReviewComment).toHaveBeenCalledWith(
      "acme/widgets",
      7,
      101,
      ":white_check_mark: **accepted**\n\n**Action:** Fixed the loop\n**Rationale:** It was indeed off by one",
    );
  });

  it("skips replying when there is no comment mapping for a finding", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);
    const resolutions = [makeResolution({ findingId: "unmapped" })];

    await svc.postRemediationResolutions("acme/widgets", 7, resolutions, {});

    expect(github.replyToReviewComment).not.toHaveBeenCalled();
  });

  it("uses the fallback icon for an unknown status", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);
    const resolutions = [
      { findingId: "f1", status: "weird_status" as ResolutionItem["status"], action: "a", rationale: "r" },
    ];

    await svc.postRemediationResolutions("acme/widgets", 7, resolutions, { f1: 5 });

    const [, , , replyBody] = github.replyToReviewComment.mock.calls[0]!;
    expect(replyBody).toContain(":grey_question:");
  });

  it("posts a markdown summary table for all resolutions", async () => {
    const github = makeGithubClient();
    const svc = new GitHubSyncService(github as never, makeLogger() as never);
    const resolutions = [
      makeResolution({ findingId: "f1", status: "accepted" }),
      makeResolution({ findingId: "f2", status: "rejected", action: "No change", rationale: "Not a bug" }),
    ];

    await svc.postRemediationResolutions("acme/widgets", 7, resolutions, {});

    const [repo, prNumber, summaryBody] = github.commentOnPR.mock.calls[0]!;
    expect(repo).toBe("acme/widgets");
    expect(prNumber).toBe(7);
    expect(summaryBody).toContain("## AI Remediation Summary");
    expect(summaryBody).toContain("| :white_check_mark: **f1** | accepted | Fixed the loop |");
    expect(summaryBody).toContain("| :no_entry_sign: **f2** | rejected | No change | Not a bug |");
  });

  it("logs a summary with resolutionCount and repliedTo counts", async () => {
    const github = makeGithubClient();
    const logger = makeLogger();
    const svc = new GitHubSyncService(github as never, logger as never);
    const resolutions = [makeResolution({ findingId: "f1" }), makeResolution({ findingId: "f2" })];

    await svc.postRemediationResolutions("acme/widgets", 7, resolutions, { f1: 10, f2: 11 });

    expect(logger.info).toHaveBeenCalledWith(
      { repo: "acme/widgets", prNumber: 7, resolutionCount: 2, repliedTo: 2 },
      "Posted remediation resolutions to PR",
    );
  });
});
