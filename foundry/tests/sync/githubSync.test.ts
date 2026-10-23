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
    linearIssueTitle: "Title",
    linearIssueUrl: null,
    repo: "acme/widget",
    branchName: "ai/lin-1",
    prNumber: 42,
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
  it("does nothing when the run has no prNumber", async () => {
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

    expect(githubClient.markPRReady).toHaveBeenCalledWith("acme/widget", 7);
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "acme/widget",
      7,
      "All AI checks passed. Ready for human review.",
    );
  });

  it("does nothing when prNumber is set but state is not ReadyForHumanReview", async () => {
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
      file: "src/foo.ts",
      lineHint: 10,
      title: "Bug found",
      details: "Something is wrong",
      ...overrides,
    };
  }

  it("creates a PR review comment per finding and maps finding id to comment id", async () => {
    const githubClient = makeGithubClient();
    githubClient.createPRReviewComment.mockResolvedValue(555);
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const map = await service.postReviewFindings(
      "acme/widget",
      7,
      [makeFinding({ id: "f1" })],
      "changes_requested",
    );

    expect(githubClient.createPRReviewComment).toHaveBeenCalledWith(
      "acme/widget",
      7,
      expect.stringContaining("[BLOCKER]"),
      "src/foo.ts",
      10,
    );
    expect(map.get("f1")).toBe(555);
  });

  it("does not add to the comment map when createPRReviewComment returns a falsy id", async () => {
    const githubClient = makeGithubClient();
    githubClient.createPRReviewComment.mockResolvedValue(0);
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const map = await service.postReviewFindings(
      "acme/widget",
      7,
      [makeFinding({ id: "f1" })],
      "approved",
    );

    expect(map.has("f1")).toBe(false);
  });

  it("submits an APPROVE review when verdict is approved", async () => {
    const githubClient = makeGithubClient();
    githubClient.createPRReviewComment.mockResolvedValue(1);
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postReviewFindings("acme/widget", 7, [makeFinding()], "approved");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/widget",
      7,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("submits a REQUEST_CHANGES review when verdict is changes_requested", async () => {
    const githubClient = makeGithubClient();
    githubClient.createPRReviewComment.mockResolvedValue(1);
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postReviewFindings("acme/widget", 7, [makeFinding()], "changes_requested");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/widget",
      7,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });

  it("handles an empty findings array without posting inline comments", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const map = await service.postReviewFindings("acme/widget", 7, [], "approved");

    expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/widget",
      7,
      expect.stringContaining("0 finding(s)"),
      "APPROVE",
    );
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
    return {
      executionVersion: 2,
      summary: "Implemented the feature.",
      filesChanged: ["src/a.ts", "src/b.ts"],
      checks: {
        lint: { status: "pass", details: "clean" },
        typecheck: { status: "pass", details: "clean" },
        tests: { status: "fail", details: "1 flake" },
      },
      notes: ["watch out for race condition"],
      prDraftCreated: true,
      score: 0.82,
      scoreRationale: "Solid implementation.",
      ...overrides,
    };
  }

  it("posts a comment with score percentage, check icons, and files under the collapse threshold", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate("acme/widget", 7, makeReport());

    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    const [repo, prNumber, body] = githubClient.commentOnPR.mock.calls[0] as [
      string,
      number,
      string,
    ];
    expect(repo).toBe("acme/widget");
    expect(prNumber).toBe(7);
    expect(body).toContain("Score: 82%");
    expect(body).toContain(":white_check_mark: **Lint**");
    expect(body).toContain(":x: **Tests**");
    expect(body).toContain("### Files changed (2)");
    expect(body).not.toContain("<details>");
    expect(body).toContain("### Notes");
    expect(body).toContain("watch out for race condition");
  });

  it("collapses files changed into a <details> block above the threshold", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);

    await service.postExecutionReportUpdate(
      "acme/widget",
      7,
      makeReport({ filesChanged: manyFiles }),
    );

    const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });

  it("omits the files section entirely when there are no files changed", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate(
      "acme/widget",
      7,
      makeReport({ filesChanged: [] }),
    );

    const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
    expect(body).not.toContain("Files changed");
  });

  it("omits the notes section when there are no notes", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate("acme/widget", 7, makeReport({ notes: [] }));

    const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
    expect(body).not.toContain("### Notes");
  });

  it("renders a heavy-minus icon for skip status checks", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate(
      "acme/widget",
      7,
      makeReport({
        checks: {
          lint: { status: "skip", details: "not run" },
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
  function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
    return {
      findingId: "f1",
      status: "accepted",
      action: "Fixed the bug",
      rationale: "It was a real issue",
      ...overrides,
    };
  }

  it("replies to the mapped GitHub comment for each resolution with a known findingId", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "acme/widget",
      7,
      [makeResolution({ findingId: "f1", status: "accepted" })],
      { f1: 555 },
    );

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "acme/widget",
      7,
      555,
      expect.stringContaining(":white_check_mark: **accepted**"),
    );
  });

  it("skips replying when the finding has no mapped GitHub comment id", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "acme/widget",
      7,
      [makeResolution({ findingId: "unmapped" })],
      {},
    );

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
  });

  it("uses a question-mark icon fallback for an unrecognized status", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "acme/widget",
      7,
      [makeResolution({ findingId: "f1", status: "weird_status" as ResolutionItem["status"] })],
      { f1: 1 },
    );

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "acme/widget",
      7,
      1,
      expect.stringContaining(":grey_question:"),
    );
  });

  it("posts a markdown summary table with a row per resolution", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions(
      "acme/widget",
      7,
      [
        makeResolution({ findingId: "f1", status: "accepted" }),
        makeResolution({ findingId: "f2", status: "rejected" }),
      ],
      { f1: 1, f2: 2 },
    );

    const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
    expect(body).toContain("## AI Remediation Summary");
    expect(body).toContain("| Finding | Status | Action | Rationale |");
    expect(body).toContain("**f1**");
    expect(body).toContain("**f2**");
    expect(body).toContain("accepted".replace("_", " "));
  });
});
