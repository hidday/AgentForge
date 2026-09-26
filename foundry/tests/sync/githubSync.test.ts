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

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: "ai/issue-1",
    prNumber: 42,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: null,
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

describe("GitHubSyncService.syncState", () => {
  it("is a no-op when the run has no PR number yet", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const run = makeRun({ prNumber: null, state: RunState.ReadyForHumanReview });

    await service.syncState(run);

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });

  it("is a no-op (drift check passes silently) when the run is not in ReadyForHumanReview", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });

  it("marks the PR ready and posts a comment when the run reaches ReadyForHumanReview (drift reconciliation)", async () => {
    const githubClient = makeGitHubClient();
    const logger = makeLogger();
    const service = new GitHubSyncService(githubClient as never, logger as never);
    const run = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42, repo: "acme/widgets" });

    await service.syncState(run);

    expect(githubClient.markPRReady).toHaveBeenCalledWith("acme/widgets", 42);
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "acme/widgets",
      42,
      "All AI checks passed. Ready for human review.",
    );
    expect(logger.debug).toHaveBeenCalled();
  });

  it("propagates an error from markPRReady without posting the comment", async () => {
    const githubClient = makeGitHubClient();
    githubClient.markPRReady.mockRejectedValue(new Error("GitHub down"));
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const run = makeRun({ state: RunState.ReadyForHumanReview });

    await expect(service.syncState(run)).rejects.toThrow("GitHub down");
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  function makeFinding(overrides: Partial<Finding> = {}): Finding {
    return {
      id: "f1",
      severity: "important",
      type: "bug",
      file: "src/a.ts",
      lineHint: 10,
      title: "Null check missing",
      details: "Could throw on null input",
      ...overrides,
    };
  }

  it("posts one inline comment per finding and maps finding id -> github comment id", async () => {
    const githubClient = makeGitHubClient();
    githubClient.createPRReviewComment.mockResolvedValueOnce(111).mockResolvedValueOnce(222);
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2", lineHint: undefined })];
    const map = await service.postReviewFindings("acme/widgets", 42, findings, "changes_requested");

    expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
      1,
      "acme/widgets",
      42,
      "**[IMPORTANT]** Null check missing\n\nCould throw on null input",
      "src/a.ts",
      10,
    );
    expect(map.get("f1")).toBe(111);
    expect(map.get("f2")).toBe(222);
    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/widgets",
      42,
      expect.stringContaining("AI Code Review: Changes Requested"),
      "REQUEST_CHANGES",
    );
  });

  it("does not map a finding when createPRReviewComment returns 0 (skipped)", async () => {
    const githubClient = makeGitHubClient();
    githubClient.createPRReviewComment.mockResolvedValue(0);
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const map = await service.postReviewFindings(
      "acme/widgets",
      42,
      [makeFinding()],
      "approved",
    );

    expect(map.size).toBe(0);
  });

  it("submits an APPROVE review when verdict is 'approved'", async () => {
    const githubClient = makeGitHubClient();
    githubClient.createPRReviewComment.mockResolvedValue(1);
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postReviewFindings("acme/widgets", 42, [makeFinding()], "approved");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/widgets",
      42,
      expect.stringContaining("AI Code Review: Approved"),
      "APPROVE",
    );
  });

  it("handles zero findings by still submitting a review", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const map = await service.postReviewFindings("acme/widgets", 42, [], "approved");

    expect(map.size).toBe(0);
    expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/widgets",
      42,
      expect.stringContaining("0 finding(s) posted"),
      "APPROVE",
    );
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
    return {
      executionVersion: 2,
      summary: "Implemented the feature",
      filesChanged: ["src/a.ts", "src/b.ts"],
      checks: {
        lint: { status: "pass", details: "no issues" },
        typecheck: { status: "fail", details: "2 errors" },
        tests: { status: "skip", details: "not run" },
      },
      notes: ["Note one"],
      prDraftCreated: true,
      score: 0.85,
      scoreRationale: "Mostly complete",
      ...overrides,
    };
  }

  it("renders checks, score, and a flat file list when file count is small", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate("acme/widgets", 42, makeReport());

    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    const [repo, prNumber, body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
    expect(repo).toBe("acme/widgets");
    expect(prNumber).toBe(42);
    expect(body).toContain("Score: 85%");
    expect(body).toContain(":white_check_mark: **Lint** -- no issues");
    expect(body).toContain(":x: **Typecheck** -- 2 errors");
    expect(body).toContain(":heavy_minus_sign: **Tests** -- not run");
    expect(body).toContain("### Files changed (2)");
    expect(body).toContain("- `src/a.ts`");
    expect(body).not.toContain("<details>");
    expect(body).toContain("### Notes");
    expect(body).toContain("- Note one");
  });

  it("collapses the file list into a <details> block when there are more than 8 files", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const files = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);

    await service.postExecutionReportUpdate(
      "acme/widgets",
      42,
      makeReport({ filesChanged: files }),
    );

    const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });

  it("omits the files and notes sections when both are empty", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate(
      "acme/widgets",
      42,
      makeReport({ filesChanged: [], notes: [] }),
    );

    const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
    expect(body).not.toContain("Files changed");
    expect(body).not.toContain("### Notes");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
    return {
      findingId: "f1",
      status: "accepted",
      action: "Added null check",
      rationale: "Prevents crash",
      ...overrides,
    };
  }

  it("replies to each mapped github comment and posts a summary table", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "acme/widgets",
      42,
      [makeResolution({ findingId: "f1", status: "accepted" }), makeResolution({ findingId: "f2", status: "rejected", action: "n/a", rationale: "not a real bug" })],
      { f1: 111 },
    );

    expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(1);
    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "acme/widgets",
      42,
      111,
      expect.stringContaining(":white_check_mark: **accepted**"),
    );

    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    const [, , summaryBody] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
    expect(summaryBody).toContain("## AI Remediation Summary");
    expect(summaryBody).toContain("| :white_check_mark: **f1** | accepted | Added null check | Prevents crash |");
    expect(summaryBody).toContain("| :no_entry_sign: **f2** | rejected | n/a | not a real bug |");
  });

  it("does not reply when a resolution has no mapped github comment id", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "acme/widgets",
      42,
      [makeResolution({ findingId: "unmapped" })],
      {},
    );

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
  });

  it("uses the grey_question icon for an unrecognized status", async () => {
    const githubClient = makeGitHubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "acme/widgets",
      42,
      [makeResolution({ status: "partially_addressed" })],
      { f1: 5 },
    );

    const replyBody = githubClient.replyToReviewComment.mock.calls[0]?.[3] as string;
    expect(replyBody).toContain(":warning: **partially addressed**");
  });
});
