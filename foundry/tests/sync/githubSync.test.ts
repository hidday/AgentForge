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

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/repo",
    branchName: "ai/run-1",
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

describe("GitHubSyncService.syncState", () => {
  let githubClient: ReturnType<typeof makeGithubClient>;
  let service: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGithubClient();
    service = new GitHubSyncService(githubClient as never, makeLogger() as never);
  });

  it("does nothing when the run has no PR number", async () => {
    await service.syncState(makeRun({ prNumber: null }));
    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when the run is ReadyForHumanReview", async () => {
    await service.syncState(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42 }));

    expect(githubClient.markPRReady).toHaveBeenCalledWith("acme/repo", 42);
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "acme/repo",
      42,
      "All AI checks passed. Ready for human review.",
    );
  });

  it("does nothing when prNumber is set but the state is not ReadyForHumanReview", async () => {
    await service.syncState(makeRun({ state: RunState.Implementing, prNumber: 42 }));
    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  let githubClient: ReturnType<typeof makeGithubClient>;
  let service: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGithubClient();
    service = new GitHubSyncService(githubClient as never, makeLogger() as never);
  });

  function makeFinding(overrides: Partial<Finding> = {}): Finding {
    return {
      id: "f1",
      severity: "blocker",
      type: "bug",
      file: "src/a.ts",
      lineHint: 10,
      title: "Null check missing",
      details: "Could throw on null input",
      ...overrides,
    };
  }

  it("posts a review comment per finding and submits an APPROVE review when approved", async () => {
    githubClient.createPRReviewComment.mockResolvedValueOnce(101);
    const map = await service.postReviewFindings(
      "acme/repo",
      42,
      [makeFinding()],
      "approved",
    );

    expect(githubClient.createPRReviewComment).toHaveBeenCalledWith(
      "acme/repo",
      42,
      expect.stringContaining("[BLOCKER]"),
      "src/a.ts",
      10,
    );
    expect(map.get("f1")).toBe(101);
    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/repo",
      42,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("submits a REQUEST_CHANGES review for a non-approved verdict", async () => {
    githubClient.createPRReviewComment.mockResolvedValueOnce(102);
    await service.postReviewFindings("acme/repo", 42, [makeFinding()], "changes_requested");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/repo",
      42,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });

  it("excludes findings from the map when createPRReviewComment returns a falsy id", async () => {
    githubClient.createPRReviewComment.mockResolvedValueOnce(0);
    const map = await service.postReviewFindings("acme/repo", 42, [makeFinding()], "approved");

    expect(map.has("f1")).toBe(false);
  });

  it("handles an empty findings array", async () => {
    const map = await service.postReviewFindings("acme/repo", 42, [], "approved");
    expect(map.size).toBe(0);
    expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
    expect(githubClient.submitPRReview).toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  let githubClient: ReturnType<typeof makeGithubClient>;
  let service: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGithubClient();
    service = new GitHubSyncService(githubClient as never, makeLogger() as never);
  });

  function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
    return {
      executionVersion: 1,
      summary: "Implemented the feature",
      filesChanged: [],
      checks: {
        lint: { status: "pass", details: "clean" },
        typecheck: { status: "fail", details: "2 errors" },
        tests: { status: "skip", details: "not run" },
      },
      notes: [],
      prDraftCreated: true,
      score: 0.82,
      scoreRationale: "Mostly solid",
      ...overrides,
    };
  }

  it("renders check icons for pass/fail/skip and omits files/notes sections when empty", async () => {
    await service.postExecutionReportUpdate("acme/repo", 42, makeReport());

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain(":white_check_mark: **Lint**");
    expect(body).toContain(":x: **Typecheck**");
    expect(body).toContain(":heavy_minus_sign: **Tests**");
    expect(body).toContain("Score: 82%");
    expect(body).not.toContain("Files changed");
    expect(body).not.toContain("### Notes");
  });

  it("renders an inline file list when filesChanged is at or below the collapse threshold", async () => {
    await service.postExecutionReportUpdate(
      "acme/repo",
      42,
      makeReport({ filesChanged: ["src/a.ts", "src/b.ts"] }),
    );

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("### Files changed (2)");
    expect(body).not.toContain("<details>");
  });

  it("renders a collapsed <details> file list when filesChanged exceeds the threshold", async () => {
    const files = Array.from({ length: 9 }, (_, i) => `src/file-${String(i)}.ts`);
    await service.postExecutionReportUpdate("acme/repo", 42, makeReport({ filesChanged: files }));

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });

  it("renders a Notes section when notes are present", async () => {
    await service.postExecutionReportUpdate(
      "acme/repo",
      42,
      makeReport({ notes: ["Watch out for X"] }),
    );

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("### Notes");
    expect(body).toContain("Watch out for X");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  let githubClient: ReturnType<typeof makeGithubClient>;
  let service: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGithubClient();
    service = new GitHubSyncService(githubClient as never, makeLogger() as never);
  });

  function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
    return {
      findingId: "f1",
      status: "accepted",
      action: "Added null check",
      rationale: "Prevents crash",
      ...overrides,
    };
  }

  it("replies to the mapped GitHub comment for each resolved finding", async () => {
    await service.postRemediationResolutions(
      "acme/repo",
      42,
      [makeResolution()],
      { f1: 101 },
    );

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "acme/repo",
      42,
      101,
      expect.stringContaining(":white_check_mark:"),
    );
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "acme/repo",
      42,
      expect.stringContaining("AI Remediation Summary"),
    );
  });

  it("skips replying when a finding has no mapped GitHub comment id", async () => {
    await service.postRemediationResolutions("acme/repo", 42, [makeResolution()], {});

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).toHaveBeenCalled();
  });

  it("renders distinct icons for rejected and partially_addressed statuses", async () => {
    await service.postRemediationResolutions(
      "acme/repo",
      42,
      [
        makeResolution({ findingId: "f1", status: "rejected" }),
        makeResolution({ findingId: "f2", status: "partially_addressed" }),
      ],
      { f1: 101, f2: 102 },
    );

    const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summaryBody).toContain(":no_entry_sign:");
    expect(summaryBody).toContain(":warning:");
  });

  it("falls back to a question-mark icon for an unrecognized status", async () => {
    await service.postRemediationResolutions(
      "acme/repo",
      42,
      [makeResolution({ status: "mystery" as unknown as ResolutionItem["status"] })],
      { f1: 101 },
    );

    const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summaryBody).toContain(":grey_question:");
  });
});
