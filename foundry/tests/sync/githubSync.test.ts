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
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
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

function buildClient() {
  return {
    markPRReady: vi.fn().mockResolvedValue(undefined),
    commentOnPR: vi.fn().mockResolvedValue(undefined),
    createPRReviewComment: vi.fn(),
    submitPRReview: vi.fn().mockResolvedValue(undefined),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
    getPRDiff: vi.fn(),
  };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

beforeEach(() => {
  logger.info.mockClear();
  logger.debug.mockClear();
});

describe("GitHubSyncService.syncState", () => {
  it("does nothing when the run has no PR number", async () => {
    const client = buildClient();
    const svc = new GitHubSyncService(client as never, logger as never);

    await svc.syncState(makeRun({ prNumber: null }));

    expect(client.markPRReady).not.toHaveBeenCalled();
  });

  it("does nothing when the run is not ReadyForHumanReview", async () => {
    const client = buildClient();
    const svc = new GitHubSyncService(client as never, logger as never);

    await svc.syncState(makeRun({ state: RunState.Implementing }));

    expect(client.markPRReady).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when ReadyForHumanReview with a PR", async () => {
    const client = buildClient();
    const svc = new GitHubSyncService(client as never, logger as never);

    await svc.syncState(makeRun());

    expect(client.markPRReady).toHaveBeenCalledWith("test-repo", 42);
    expect(client.commentOnPR).toHaveBeenCalledWith(
      "test-repo",
      42,
      "All AI checks passed. Ready for human review.",
    );
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  function makeFinding(overrides: Partial<Finding> = {}): Finding {
    return {
      id: "f1",
      severity: "important",
      type: "bug",
      file: "src/foo.ts",
      lineHint: 10,
      title: "Null deref",
      details: "Could throw",
      ...overrides,
    };
  }

  it("posts one inline comment per finding and maps finding id to comment id", async () => {
    const client = buildClient();
    client.createPRReviewComment.mockResolvedValueOnce(111).mockResolvedValueOnce(222);
    const svc = new GitHubSyncService(client as never, logger as never);

    const map = await svc.postReviewFindings(
      "test-repo",
      42,
      [makeFinding({ id: "f1" }), makeFinding({ id: "f2" })],
      "changes_requested",
    );

    expect(map.get("f1")).toBe(111);
    expect(map.get("f2")).toBe(222);
    expect(client.createPRReviewComment).toHaveBeenCalledTimes(2);
  });

  it("skips mapping a finding when createPRReviewComment returns a falsy id", async () => {
    const client = buildClient();
    client.createPRReviewComment.mockResolvedValueOnce(undefined);
    const svc = new GitHubSyncService(client as never, logger as never);

    const map = await svc.postReviewFindings("test-repo", 42, [makeFinding()], "approved");

    expect(map.size).toBe(0);
  });

  it("submits an APPROVE review event for an approved verdict", async () => {
    const client = buildClient();
    client.createPRReviewComment.mockResolvedValue(1);
    const svc = new GitHubSyncService(client as never, logger as never);

    await svc.postReviewFindings("test-repo", 42, [makeFinding()], "approved");

    expect(client.submitPRReview).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("submits a REQUEST_CHANGES review event for any non-approved verdict", async () => {
    const client = buildClient();
    client.createPRReviewComment.mockResolvedValue(1);
    const svc = new GitHubSyncService(client as never, logger as never);

    await svc.postReviewFindings("test-repo", 42, [makeFinding()], "changes_requested");

    expect(client.submitPRReview).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
    return {
      executionVersion: 1,
      summary: "Implemented the feature.",
      filesChanged: ["src/a.ts"],
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "fail", details: "2 errors" },
        tests: { status: "skip", details: "not run" },
      },
      notes: [],
      prDraftCreated: true,
      score: 0.6,
      scoreRationale: "Typecheck failing.",
      ...overrides,
    };
  }

  it("posts a comment including the score percentage and check icons", async () => {
    const client = buildClient();
    const svc = new GitHubSyncService(client as never, logger as never);

    await svc.postExecutionReportUpdate("test-repo", 42, makeReport());

    const body = client.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("Score: 60%");
    expect(body).toContain(":white_check_mark: **Lint**");
    expect(body).toContain(":x: **Typecheck**");
  });

  it("lists files inline (not collapsed) when 8 or fewer files changed", async () => {
    const client = buildClient();
    const svc = new GitHubSyncService(client as never, logger as never);

    await svc.postExecutionReportUpdate(
      "test-repo",
      42,
      makeReport({ filesChanged: ["a.ts", "b.ts"] }),
    );

    const body = client.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("### Files changed (2)");
    expect(body).not.toContain("<details>");
  });

  it("collapses the file list behind <details> when more than 8 files changed", async () => {
    const client = buildClient();
    const svc = new GitHubSyncService(client as never, logger as never);
    const files = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);

    await svc.postExecutionReportUpdate("test-repo", 42, makeReport({ filesChanged: files }));

    const body = client.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });

  it("omits the files section entirely when no files changed", async () => {
    const client = buildClient();
    const svc = new GitHubSyncService(client as never, logger as never);

    await svc.postExecutionReportUpdate("test-repo", 42, makeReport({ filesChanged: [] }));

    const body = client.commentOnPR.mock.calls[0][2] as string;
    expect(body).not.toContain("Files changed");
  });

  it("includes a notes section only when notes are present", async () => {
    const client = buildClient();
    const svc = new GitHubSyncService(client as never, logger as never);

    await svc.postExecutionReportUpdate(
      "test-repo",
      42,
      makeReport({ notes: ["Watch out for X"] }),
    );

    const body = client.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("### Notes");
    expect(body).toContain("Watch out for X");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
    return {
      findingId: "f1",
      status: "accepted",
      action: "Added a null check",
      rationale: "Prevents a crash",
      ...overrides,
    };
  }

  it("replies to the mapped GitHub comment for each resolution with a known comment id", async () => {
    const client = buildClient();
    const svc = new GitHubSyncService(client as never, logger as never);

    await svc.postRemediationResolutions("test-repo", 42, [makeResolution()], { f1: 111 });

    expect(client.replyToReviewComment).toHaveBeenCalledWith(
      "test-repo",
      42,
      111,
      expect.stringContaining("accepted"),
    );
  });

  it("does not reply when a resolution has no mapped comment id", async () => {
    const client = buildClient();
    const svc = new GitHubSyncService(client as never, logger as never);

    await svc.postRemediationResolutions("test-repo", 42, [makeResolution({ findingId: "f2" })], {
      f1: 111,
    });

    expect(client.replyToReviewComment).not.toHaveBeenCalled();
  });

  it("posts a summary comment with a row per resolution", async () => {
    const client = buildClient();
    const svc = new GitHubSyncService(client as never, logger as never);

    await svc.postRemediationResolutions(
      "test-repo",
      42,
      [makeResolution({ findingId: "f1" }), makeResolution({ findingId: "f2", status: "rejected" })],
      { f1: 111 },
    );

    const summaryCall = client.commentOnPR.mock.calls.find((c: unknown[]) =>
      (c[2] as string).includes("AI Remediation Summary"),
    );
    expect(summaryCall).toBeDefined();
    const body = summaryCall![2] as string;
    expect(body).toContain("f1");
    expect(body).toContain("f2");
  });

  it("uses a fallback icon for an unrecognized status", async () => {
    const client = buildClient();
    const svc = new GitHubSyncService(client as never, logger as never);

    await svc.postRemediationResolutions(
      "test-repo",
      42,
      [makeResolution({ status: "unknown_status" as never })],
      { f1: 111 },
    );

    const replyBody = client.replyToReviewComment.mock.calls[0][3] as string;
    expect(replyBody).toContain(":grey_question:");
  });
});
