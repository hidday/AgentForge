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
    linearIssueIdentifier: "PRY-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/repo",
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
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeGithubClient() {
  return {
    markPRReady: vi.fn().mockResolvedValue(undefined),
    commentOnPR: vi.fn().mockResolvedValue(undefined),
    createPRReviewComment: vi.fn().mockResolvedValue(1000),
    submitPRReview: vi.fn().mockResolvedValue(undefined),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
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
    title: "Null check missing",
    details: "Could crash on null input.",
    ...overrides,
  };
}

describe("GitHubSyncService.syncState", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does nothing when the run has no PR number", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.syncState(makeRun({ prNumber: null, state: RunState.ReadyForHumanReview }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when state is ReadyForHumanReview", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7 }));

    expect(githubClient.markPRReady).toHaveBeenCalledWith("acme/repo", 7);
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "acme/repo",
      7,
      "All AI checks passed. Ready for human review.",
    );
  });

  it("does not touch the PR for other states", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Implementing, prNumber: 7 }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts one review comment per finding and maps finding id to github comment id", async () => {
    const githubClient = makeGithubClient();
    githubClient.createPRReviewComment
      .mockResolvedValueOnce(1001)
      .mockResolvedValueOnce(1002);
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2", lineHint: undefined })];
    const map = await service.postReviewFindings("acme/repo", 7, findings, "changes_requested");

    expect(githubClient.createPRReviewComment).toHaveBeenCalledTimes(2);
    expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
      1,
      "acme/repo",
      7,
      "**[IMPORTANT]** Null check missing\n\nCould crash on null input.",
      "src/a.ts",
      10,
    );
    expect(map.get("f1")).toBe(1001);
    expect(map.get("f2")).toBe(1002);
  });

  it("submits an APPROVE review when verdict is approved", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postReviewFindings("acme/repo", 7, [], "approved");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/repo",
      7,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("submits a REQUEST_CHANGES review for any non-approved verdict", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postReviewFindings("acme/repo", 7, [makeFinding()], "changes_requested");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/repo",
      7,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });

  it("does not record a mapping entry when createPRReviewComment returns a falsy id", async () => {
    const githubClient = makeGithubClient();
    githubClient.createPRReviewComment.mockResolvedValue(0);
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const map = await service.postReviewFindings("acme/repo", 7, [makeFinding()], "approved");

    expect(map.size).toBe(0);
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  beforeEach(() => vi.clearAllMocks());

  function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
    return {
      executionVersion: 2,
      summary: "Implemented the feature.",
      filesChanged: ["src/a.ts", "src/b.ts"],
      checks: {
        lint: { status: "pass", details: "clean" },
        typecheck: { status: "fail", details: "2 errors" },
        tests: { status: "skip", details: "not run" },
      },
      notes: ["Followed existing patterns."],
      prDraftCreated: true,
      score: 0.82,
      scoreRationale: "Mostly solid.",
      ...overrides,
    };
  }

  it("posts a comment with score percentage and check icons for pass/fail/skip", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate("acme/repo", 7, makeReport());

    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    const [, , body] = githubClient.commentOnPR.mock.calls[0];
    expect(body).toContain("Score: 82%");
    expect(body).toContain(":white_check_mark: **Lint**");
    expect(body).toContain(":x: **Typecheck**");
    expect(body).toContain(":heavy_minus_sign: **Tests**");
    expect(body).toContain("### Files changed (2)");
    expect(body).toContain("### Notes");
  });

  it("omits the files section when filesChanged is empty", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate("acme/repo", 7, makeReport({ filesChanged: [] }));

    const [, , body] = githubClient.commentOnPR.mock.calls[0];
    expect(body).not.toContain("Files changed");
  });

  it("omits the notes section when notes is empty", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate("acme/repo", 7, makeReport({ notes: [] }));

    const [, , body] = githubClient.commentOnPR.mock.calls[0];
    expect(body).not.toContain("### Notes");
  });

  it("collapses the files list into a <details> block when there are more than 8 files", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);

    await service.postExecutionReportUpdate("acme/repo", 7, makeReport({ filesChanged: manyFiles }));

    const [, , body] = githubClient.commentOnPR.mock.calls[0];
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  beforeEach(() => vi.clearAllMocks());

  function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
    return {
      findingId: "f1",
      status: "accepted",
      action: "Added a null check",
      rationale: "Prevents crash",
      ...overrides,
    };
  }

  it("replies to the mapped github comment for each resolution with a comment id", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "acme/repo",
      7,
      [makeResolution({ findingId: "f1" })],
      { f1: 1001 },
    );

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "acme/repo",
      7,
      1001,
      expect.stringContaining("accepted"),
    );
  });

  it("does not reply when a resolution has no matching github comment id", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "acme/repo",
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
      "acme/repo",
      7,
      [makeResolution({ findingId: "f1", status: "weird" as never })],
      { f1: 1001 },
    );

    const [, , , replyBody] = githubClient.replyToReviewComment.mock.calls[0];
    expect(replyBody).toContain(":grey_question:");
  });

  it("always posts a summary table comment covering all resolutions", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "acme/repo",
      7,
      [makeResolution({ findingId: "f1" }), makeResolution({ findingId: "f2", status: "rejected" })],
      { f1: 1001 },
    );

    const summaryCall = githubClient.commentOnPR.mock.calls.find((c) =>
      (c[2] as string).includes("AI Remediation Summary"),
    );
    expect(summaryCall).toBeDefined();
    const summaryBody = summaryCall?.[2] as string;
    expect(summaryBody).toContain("f1");
    expect(summaryBody).toContain("f2");
  });
});
