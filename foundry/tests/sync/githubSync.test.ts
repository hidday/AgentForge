import { describe, it, expect, vi } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Finding } from "../../src/schemas/review.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { ResolutionItem } from "../../src/schemas/remediation.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeGithubClient() {
  return {
    markPRReady: vi.fn().mockResolvedValue(undefined),
    commentOnPR: vi.fn().mockResolvedValue(undefined),
    createPRReviewComment: vi.fn(),
    submitPRReview: vi.fn().mockResolvedValue(undefined),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
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
    repo: "test-repo",
    branchName: "ai/lin-1",
    prNumber: 7,
    state: RunState.ReadyForHumanReview,
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

describe("GitHubSyncService.syncState", () => {
  it("does nothing when the run has no PR yet", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ prNumber: null, state: RunState.ReadyForHumanReview }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when the run reaches ReadyForHumanReview", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7 }));

    expect(githubClient.markPRReady).toHaveBeenCalledWith("test-repo", 7);
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "test-repo",
      7,
      "All AI checks passed. Ready for human review.",
    );
  });

  it("does not mark ready for other states even with a PR present", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.AIReview, prNumber: 7 }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  function makeFinding(overrides: Partial<Finding> = {}): Finding {
    return {
      id: "f1",
      severity: "blocker",
      type: "bug",
      file: "src/a.ts",
      title: "Null deref",
      details: "Possible null dereference",
      ...overrides,
    };
  }

  it("posts each finding as an inline comment and maps finding id to comment id", async () => {
    const githubClient = makeGithubClient();
    githubClient.createPRReviewComment.mockResolvedValueOnce(101).mockResolvedValueOnce(102);
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const map = await svc.postReviewFindings(
      "test-repo",
      7,
      [makeFinding({ id: "f1" }), makeFinding({ id: "f2" })],
      "changes_requested",
    );

    expect(map.get("f1")).toBe(101);
    expect(map.get("f2")).toBe(102);
    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "test-repo",
      7,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });

  it("skips mapping a finding whose comment creation returned no id", async () => {
    const githubClient = makeGithubClient();
    githubClient.createPRReviewComment.mockResolvedValueOnce(undefined);
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const map = await svc.postReviewFindings("test-repo", 7, [makeFinding()], "approved");

    expect(map.size).toBe(0);
    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "test-repo",
      7,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
    return {
      executionVersion: 2,
      summary: "Implemented the feature",
      filesChanged: ["src/a.ts"],
      checks: {
        lint: { status: "pass", details: "clean" },
        typecheck: { status: "pass", details: "clean" },
        tests: { status: "fail", details: "1 failing" },
      },
      notes: ["Note one"],
      prDraftCreated: true,
      score: 0.75,
      scoreRationale: "Mostly good",
      ...overrides,
    };
  }

  it("renders a comment with score, check icons, and posts it", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postExecutionReportUpdate("test-repo", 7, makeReport());

    const [repo, prNumber, body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
    expect(repo).toBe("test-repo");
    expect(prNumber).toBe(7);
    expect(body).toContain("Score: 75%");
    expect(body).toContain(":white_check_mark: **Lint**");
    expect(body).toContain(":x: **Tests**");
    expect(body).toContain("Note one");
  });

  it("uses a collapsible <details> block when many files changed", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file-${i}.ts`);

    await svc.postExecutionReportUpdate("test-repo", 7, makeReport({ filesChanged: manyFiles }));

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });

  it("omits the files and notes sections when they are empty", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postExecutionReportUpdate(
      "test-repo",
      7,
      makeReport({ filesChanged: [], notes: [] }),
    );

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).not.toContain("Files changed");
    expect(body).not.toContain("### Notes");
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

  it("replies on mapped review comments and posts a summary table", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postRemediationResolutions(
      "test-repo",
      7,
      [makeResolution({ findingId: "f1", status: "accepted" })],
      { f1: 101 },
    );

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "test-repo",
      7,
      101,
      expect.stringContaining("accepted"),
    );
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "test-repo",
      7,
      expect.stringContaining("AI Remediation Summary"),
    );
  });

  it("does not reply when a resolution has no mapped comment id", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postRemediationResolutions("test-repo", 7, [makeResolution({ findingId: "f-unmapped" })], {});

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).toHaveBeenCalled();
  });

  it("falls back to a question-mark icon for an unrecognized status", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postRemediationResolutions(
      "test-repo",
      7,
      [makeResolution({ status: "partially_addressed" as never, findingId: "f1" })],
      { f1: 101 },
    );

    const body = githubClient.replyToReviewComment.mock.calls[0][3] as string;
    expect(body).toContain(":warning:");
  });
});
