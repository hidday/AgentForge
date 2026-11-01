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
    linearIssueId: "lin-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: "ai/issue-1",
    prNumber: 7,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("GitHubSyncService.syncState", () => {
  it("does nothing when the run has no PR number yet", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.syncState(makeRun({ prNumber: null, state: RunState.ReadyForHumanReview }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when the run reaches ReadyForHumanReview", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7 }));

    expect(githubClient.markPRReady).toHaveBeenCalledWith("acme/widgets", 7);
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "acme/widgets",
      7,
      expect.stringContaining("Ready for human review"),
    );
  });

  it("does nothing for states other than ReadyForHumanReview", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Implementing, prNumber: 7 }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  function makeFinding(overrides: Partial<Finding> = {}): Finding {
    return {
      id: "f1",
      severity: "blocker",
      type: "bug",
      file: "src/a.ts",
      title: "Issue",
      details: "Details",
      ...overrides,
    };
  }

  it("posts each finding as a review comment and maps comment ids by finding id", async () => {
    const githubClient = makeGithubClient();
    githubClient.createPRReviewComment
      .mockResolvedValueOnce(1001)
      .mockResolvedValueOnce(1002);
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const map = await service.postReviewFindings(
      "acme/widgets",
      7,
      [makeFinding({ id: "f1" }), makeFinding({ id: "f2", lineHint: 20 })],
      "approved",
    );

    expect(map.get("f1")).toBe(1001);
    expect(map.get("f2")).toBe(1002);
    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/widgets",
      7,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("does not map a finding whose comment id is falsy (e.g. 0)", async () => {
    const githubClient = makeGithubClient();
    githubClient.createPRReviewComment.mockResolvedValueOnce(0);
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const map = await service.postReviewFindings(
      "acme/widgets",
      7,
      [makeFinding({ id: "f1" })],
      "changes_requested",
    );

    expect(map.has("f1")).toBe(false);
    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/widgets",
      7,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
    return {
      executionVersion: 1,
      summary: "Implemented the feature",
      filesChanged: [],
      checks: {
        lint: { status: "pass", details: "clean" },
        typecheck: { status: "pass", details: "clean" },
        tests: { status: "pass", details: "all green" },
      },
      notes: [],
      prDraftCreated: true,
      score: 0.9,
      scoreRationale: "Looks solid",
      ...overrides,
    };
  }

  it("renders a short file list inline when under the collapse threshold", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate(
      "acme/widgets",
      7,
      makeReport({ filesChanged: ["src/a.ts", "src/b.ts"] }),
    );

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("Files changed (2)");
    expect(body).not.toContain("<details>");
  });

  it("collapses the file list behind <details> above the threshold", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const files = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);

    await service.postExecutionReportUpdate("acme/widgets", 7, makeReport({ filesChanged: files }));

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });

  it("omits the files section entirely when nothing changed", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate("acme/widgets", 7, makeReport({ filesChanged: [] }));

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).not.toContain("Files changed");
  });

  it("includes a notes section only when notes are present", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate(
      "acme/widgets",
      7,
      makeReport({ notes: ["Watch out for X"] }),
    );

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("### Notes");
    expect(body).toContain("Watch out for X");
  });

  it("renders a failing/skip check icon for each status", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate(
      "acme/widgets",
      7,
      makeReport({
        checks: {
          lint: { status: "fail", details: "2 errors" },
          typecheck: { status: "skip", details: "n/a" },
          tests: { status: "pass", details: "ok" },
        },
      }),
    );

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain(":x:");
    expect(body).toContain(":heavy_minus_sign:");
    expect(body).toContain(":white_check_mark:");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
    return {
      findingId: "f1",
      status: "accepted",
      action: "Fixed the null check",
      rationale: "Was missing a guard",
      ...overrides,
    };
  }

  it("replies to the mapped GitHub comment for each resolution with a known comment id", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "acme/widgets",
      7,
      [makeResolution({ findingId: "f1" })],
      { f1: 1001 },
    );

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "acme/widgets",
      7,
      1001,
      expect.stringContaining("accepted"),
    );
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "acme/widgets",
      7,
      expect.stringContaining("AI Remediation Summary"),
    );
  });

  it("skips replying when a resolution has no mapped comment id", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "acme/widgets",
      7,
      [makeResolution({ findingId: "unmapped" })],
      {},
    );

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
  });

  it("falls back to a question-mark icon for an unrecognized status", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "acme/widgets",
      7,
      [makeResolution({ findingId: "f1", status: "partially_addressed" })],
      { f1: 1001 },
    );

    const replyBody = githubClient.replyToReviewComment.mock.calls[0][3] as string;
    expect(replyBody).toContain(":warning:");
  });
});
