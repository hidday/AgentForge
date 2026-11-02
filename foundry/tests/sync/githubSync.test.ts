import { describe, it, expect, vi } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Finding } from "../../src/schemas/review.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { ResolutionItem } from "../../src/schemas/remediation.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/backend",
    branchName: null,
    prNumber: 5,
    state: RunState.ReadyForHumanReview,
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
    createPRReviewComment: vi.fn().mockResolvedValue(1001),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
    submitPRReview: vi.fn().mockResolvedValue(undefined),
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
    filesChanged: ["src/a.ts", "src/b.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "fail", details: "1 failing" },
    },
    notes: ["Added a fallback for null input"],
    prDraftCreated: true,
    score: 0.75,
    scoreRationale: "Mostly done",
    ...overrides,
  };
}

describe("GitHubSyncService.syncState", () => {
  it("does nothing when the run has no PR number", async () => {
    const githubClient = makeGitHubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ prNumber: null }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
  });

  it("does nothing when the run is not ReadyForHumanReview", async () => {
    const githubClient = makeGitHubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Implementing }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when ReadyForHumanReview with a PR", async () => {
    const githubClient = makeGitHubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.syncState(makeRun());

    expect(githubClient.markPRReady).toHaveBeenCalledWith("acme/backend", 5);
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "acme/backend",
      5,
      "All AI checks passed. Ready for human review.",
    );
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
      details: "foo can be null",
      ...overrides,
    };
  }

  it("posts an inline comment per finding and maps finding id to comment id", async () => {
    const githubClient = makeGitHubClient();
    githubClient.createPRReviewComment
      .mockResolvedValueOnce(1001)
      .mockResolvedValueOnce(1002);
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2", severity: "nit" })];
    const commentMap = await svc.postReviewFindings("acme/backend", 5, findings, "changes_requested");

    expect(commentMap.get("f1")).toBe(1001);
    expect(commentMap.get("f2")).toBe(1002);
    expect(githubClient.createPRReviewComment).toHaveBeenCalledWith(
      "acme/backend",
      5,
      expect.stringContaining("[BLOCKER]"),
      "src/a.ts",
      undefined,
    );
  });

  it("submits a REQUEST_CHANGES review when verdict is changes_requested", async () => {
    const githubClient = makeGitHubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postReviewFindings("acme/backend", 5, [makeFinding()], "changes_requested");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/backend",
      5,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });

  it("submits an APPROVE review when verdict is approved", async () => {
    const githubClient = makeGitHubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postReviewFindings("acme/backend", 5, [], "approved");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/backend",
      5,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  it("renders a short file list when files changed is at or under the collapse threshold", async () => {
    const githubClient = makeGitHubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postExecutionReportUpdate("acme/backend", 5, makeExecutionReport());

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("### Files changed (2)");
    expect(body).not.toContain("<details>");
    expect(body).toContain(":x:");
    expect(body).toContain("75%");
  });

  it("collapses the file list behind <details> when above the threshold", async () => {
    const githubClient = makeGitHubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    await svc.postExecutionReportUpdate(
      "acme/backend",
      5,
      makeExecutionReport({ filesChanged: manyFiles }),
    );

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });

  it("omits the files section entirely when nothing changed", async () => {
    const githubClient = makeGitHubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postExecutionReportUpdate(
      "acme/backend",
      5,
      makeExecutionReport({ filesChanged: [] }),
    );

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).not.toContain("Files changed");
  });

  it("omits the notes section when there are no notes", async () => {
    const githubClient = makeGitHubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postExecutionReportUpdate("acme/backend", 5, makeExecutionReport({ notes: [] }));

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).not.toContain("### Notes");
  });

  it("includes all pass/fail/skip icons correctly", async () => {
    const githubClient = makeGitHubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postExecutionReportUpdate(
      "acme/backend",
      5,
      makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "" },
          typecheck: { status: "fail", details: "" },
          tests: { status: "skip", details: "" },
        },
      }),
    );

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain(":white_check_mark:");
    expect(body).toContain(":x:");
    expect(body).toContain(":heavy_minus_sign:");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
    return {
      findingId: "f1",
      status: "accepted",
      action: "Added null guard",
      rationale: "Real bug",
      ...overrides,
    };
  }

  it("replies to the original review comment for findings with a known comment id", async () => {
    const githubClient = makeGitHubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postRemediationResolutions(
      "acme/backend",
      5,
      [makeResolution({ findingId: "f1" })],
      { f1: 1001 },
    );

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "acme/backend",
      5,
      1001,
      expect.stringContaining("accepted"),
    );
  });

  it("does not reply when the finding has no mapped comment id", async () => {
    const githubClient = makeGitHubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postRemediationResolutions(
      "acme/backend",
      5,
      [makeResolution({ findingId: "unmapped" })],
      {},
    );

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
  });

  it("posts a summary table covering every resolution status", async () => {
    const githubClient = makeGitHubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postRemediationResolutions(
      "acme/backend",
      5,
      [
        makeResolution({ findingId: "f1", status: "accepted" }),
        makeResolution({ findingId: "f2", status: "rejected" }),
        makeResolution({ findingId: "f3", status: "partially_addressed" }),
      ],
      {},
    );

    const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summaryBody).toContain("## AI Remediation Summary");
    expect(summaryBody).toContain("f1");
    expect(summaryBody).toContain("f2");
    expect(summaryBody).toContain("f3");
  });
});
