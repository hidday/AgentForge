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
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
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

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "important",
    type: "bug",
    file: "src/a.ts",
    lineHint: 10,
    title: "Issue title",
    details: "Issue details",
    ...overrides,
  };
}

function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented things.",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "fail", details: "1 failing" },
    },
    notes: ["note one"],
    prDraftCreated: true,
    score: 0.75,
    scoreRationale: "solid",
    ...overrides,
  };
}

function makeClient() {
  return {
    verifyRepoAccess: vi.fn(),
    getDefaultBranch: vi.fn(),
    createBranch: vi.fn(),
    createDraftPR: vi.fn(),
    commentOnPR: vi.fn().mockResolvedValue(undefined),
    getPRDiff: vi.fn(),
    markPRReady: vi.fn().mockResolvedValue(undefined),
    listPRComments: vi.fn(),
    createPRReviewComment: vi.fn().mockResolvedValue(100),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
    submitPRReview: vi.fn().mockResolvedValue(undefined),
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("GitHubSyncService.syncState", () => {
  it("marks the PR ready and comments when the run reaches ReadyForHumanReview", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42 }));

    expect(client.markPRReady).toHaveBeenCalledWith("org/repo", 42);
    expect(client.commentOnPR).toHaveBeenCalledWith(
      "org/repo",
      42,
      expect.stringContaining("Ready for human review"),
    );
  });

  it("does nothing when the run has no PR yet", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.syncState(makeRun({ prNumber: null }));

    expect(client.markPRReady).not.toHaveBeenCalled();
    expect(client.commentOnPR).not.toHaveBeenCalled();
  });

  it("does nothing for states other than ReadyForHumanReview", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Implementing, prNumber: 42 }));

    expect(client.markPRReady).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  it("posts one review comment per finding and submits REQUEST_CHANGES for non-approved verdicts", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);
    const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2" })];

    const map = await svc.postReviewFindings("org/repo", 1, findings, "changes_requested");

    expect(client.createPRReviewComment).toHaveBeenCalledTimes(2);
    expect(map.get("f1")).toBe(100);
    expect(client.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      1,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });

  it("submits APPROVE when the verdict is approved", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postReviewFindings("org/repo", 1, [], "approved");

    expect(client.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      1,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("does not map a finding whose comment creation returned 0 (skipped)", async () => {
    const client = makeClient();
    client.createPRReviewComment.mockResolvedValue(0);
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    const map = await svc.postReviewFindings("org/repo", 1, [makeFinding()], "changes_requested");

    expect(map.size).toBe(0);
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  it("renders checks, score, and a collapsed-or-flat file list depending on count", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postExecutionReportUpdate("org/repo", 1, makeReport());

    const body = client.commentOnPR.mock.calls[0]![2] as string;
    expect(body).toContain("Score: 75%");
    expect(body).toContain(":white_check_mark: **Lint**");
    expect(body).toContain(":x: **Tests**");
    expect(body).toContain("Files changed (1)");
    expect(body).not.toContain("<details>");
  });

  it("collapses the file list behind <details> above the threshold", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);

    await svc.postExecutionReportUpdate("org/repo", 1, makeReport({ filesChanged: manyFiles }));

    const body = client.commentOnPR.mock.calls[0]![2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });

  it("omits the files section entirely when nothing changed", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postExecutionReportUpdate("org/repo", 1, makeReport({ filesChanged: [] }));

    const body = client.commentOnPR.mock.calls[0]![2] as string;
    expect(body).not.toContain("Files changed");
  });

  it("omits the notes section when there are no notes", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postExecutionReportUpdate("org/repo", 1, makeReport({ notes: [] }));

    const body = client.commentOnPR.mock.calls[0]![2] as string;
    expect(body).not.toContain("### Notes");
  });

  it("renders a neutral icon for a skipped check", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postExecutionReportUpdate(
      "org/repo",
      1,
      makeReport({ checks: { lint: { status: "skip", details: "n/a" }, typecheck: { status: "pass", details: "" }, tests: { status: "pass", details: "" } } as never }),
    );

    const body = client.commentOnPR.mock.calls[0]![2] as string;
    expect(body).toContain(":heavy_minus_sign:");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
    return {
      findingId: "f1",
      status: "accepted",
      action: "Fixed it",
      rationale: "Was a real bug",
      ...overrides,
    };
  }

  it("replies to mapped comments and posts a summary table", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postRemediationResolutions(
      "org/repo",
      1,
      [makeResolution({ findingId: "f1" }), makeResolution({ findingId: "f2", status: "rejected" })],
      { f1: 100 },
    );

    expect(client.replyToReviewComment).toHaveBeenCalledTimes(1);
    expect(client.replyToReviewComment).toHaveBeenCalledWith("org/repo", 1, 100, expect.any(String));

    const summaryBody = client.commentOnPR.mock.calls[0]![2] as string;
    expect(summaryBody).toContain("AI Remediation Summary");
    expect(summaryBody).toContain("f1");
    expect(summaryBody).toContain("f2");
  });

  it("skips replying when a finding has no mapped GitHub comment id", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postRemediationResolutions("org/repo", 1, [makeResolution()], {});

    expect(client.replyToReviewComment).not.toHaveBeenCalled();
  });

  it("falls back to a question-mark icon for an unrecognized status", async () => {
    const client = makeClient();
    const svc = new GitHubSyncService(client as never, makeLogger() as never);

    await svc.postRemediationResolutions(
      "org/repo",
      1,
      [makeResolution({ status: "weird-status" as never })],
      {},
    );

    const summaryBody = client.commentOnPR.mock.calls[0]![2] as string;
    expect(summaryBody).toContain(":grey_question:");
  });
});
