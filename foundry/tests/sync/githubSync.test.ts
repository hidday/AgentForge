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
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: "ai/issue-1",
    prNumber: 42,
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

describe("GitHubSyncService.syncState", () => {
  let githubClient: ReturnType<typeof makeGithubClient>;
  let service: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGithubClient();
    service = new GitHubSyncService(githubClient as never, makeLogger() as never);
  });

  it("is a no-op when the run has no PR yet", async () => {
    await service.syncState(makeRun({ prNumber: null }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when the run reaches ReadyForHumanReview", async () => {
    await service.syncState(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7 }));

    expect(githubClient.markPRReady).toHaveBeenCalledWith("org/repo", 7);
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "org/repo",
      7,
      "All AI checks passed. Ready for human review.",
    );
  });

  it("does nothing for other in-progress states even with a PR assigned", async () => {
    await service.syncState(makeRun({ state: RunState.Implementing, prNumber: 7 }));

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
      severity: "important",
      type: "bug",
      file: "src/a.ts",
      title: "Null check missing",
      details: "Could throw on null input",
      ...overrides,
    };
  }

  it("posts one review comment per finding and maps ids by finding id", async () => {
    githubClient.createPRReviewComment
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(11);

    const map = await service.postReviewFindings(
      "org/repo",
      1,
      [makeFinding({ id: "f1" }), makeFinding({ id: "f2" })],
      "approved",
    );

    expect(map.get("f1")).toBe(10);
    expect(map.get("f2")).toBe(11);
    expect(githubClient.createPRReviewComment).toHaveBeenCalledWith(
      "org/repo",
      1,
      expect.stringContaining("Null check missing"),
      "src/a.ts",
      undefined,
    );
  });

  it("omits a finding from the map when no comment id was returned", async () => {
    githubClient.createPRReviewComment.mockResolvedValue(0);

    const map = await service.postReviewFindings("org/repo", 1, [makeFinding()], "approved");

    expect(map.size).toBe(0);
  });

  it("submits an APPROVE review when the verdict is approved", async () => {
    githubClient.createPRReviewComment.mockResolvedValue(1);

    await service.postReviewFindings("org/repo", 1, [makeFinding()], "approved");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      1,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("submits a REQUEST_CHANGES review for any non-approved verdict", async () => {
    githubClient.createPRReviewComment.mockResolvedValue(1);

    await service.postReviewFindings("org/repo", 1, [makeFinding()], "changes_requested");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      1,
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
        tests: { status: "fail", details: "2 failing" },
      },
      notes: [],
      prDraftCreated: true,
      score: 0.75,
      scoreRationale: "Minor issues",
      ...overrides,
    };
  }

  it("posts a comment with score, check icons, and omits files/notes sections when empty", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate("org/repo", 1, makeReport());

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("Score: 75%");
    expect(body).toContain(":white_check_mark: **Lint**");
    expect(body).toContain(":x: **Tests**");
    expect(body).not.toContain("Files changed");
    expect(body).not.toContain("### Notes");
  });

  it("lists files inline when there are few of them", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate(
      "org/repo",
      1,
      makeReport({ filesChanged: ["src/a.ts", "src/b.ts"], notes: ["Watch out for X"] }),
    );

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("Files changed (2)");
    expect(body).toContain("`src/a.ts`");
    expect(body).not.toContain("<details>");
    expect(body).toContain("### Notes");
    expect(body).toContain("Watch out for X");
  });

  it("collapses files into a <details> block when there are many", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const files = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);

    await service.postExecutionReportUpdate("org/repo", 1, makeReport({ filesChanged: files }));

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });

  it("renders a skip icon for skipped checks", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate(
      "org/repo",
      1,
      makeReport({ checks: { ...makeReport().checks, typecheck: { status: "skip", details: "n/a" } } }),
    );

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain(":heavy_minus_sign: **Typecheck**");
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

  it("replies to the mapped GitHub comment for each resolution with a matching comment id", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "org/repo",
      1,
      [makeResolution({ findingId: "f1" })],
      { f1: 10 },
    );

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "org/repo",
      1,
      10,
      expect.stringContaining("accepted"),
    );
  });

  it("skips replying when a resolution has no mapped comment id", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "org/repo",
      1,
      [makeResolution({ findingId: "unmapped" })],
      {},
    );

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
  });

  it("always posts a summary table comment with a known status's icon", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "org/repo",
      1,
      [makeResolution({ status: "partially_addressed" })],
      {},
    );

    const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summary).toContain("AI Remediation Summary");
    expect(summary).toContain(":warning:");
    expect(summary).toContain("partially addressed");
  });

  it("falls back to a question-mark icon for an unrecognized status", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "org/repo",
      1,
      [makeResolution({ status: "mystery" as never })],
      {},
    );

    const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summary).toContain(":grey_question:");
  });
});
