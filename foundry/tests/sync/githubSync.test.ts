import { describe, it, expect, vi } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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
    repo: "org/repo",
    branchName: "ai/run-1",
    prNumber: 10,
    state: RunState.Implementing,
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
  it("does nothing when the run has no PR number yet", async () => {
    const client = makeClient();
    const service = new GitHubSyncService(client, makeLogger() as never);

    await service.syncState(makeRun({ prNumber: null, state: RunState.ReadyForHumanReview }));

    expect(client.markPRReady).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when the run reaches ReadyForHumanReview", async () => {
    const client = makeClient();
    const service = new GitHubSyncService(client, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 10 }));

    expect(client.markPRReady).toHaveBeenCalledWith("org/repo", 10);
    expect(client.commentOnPR).toHaveBeenCalledWith(
      "org/repo",
      10,
      "All AI checks passed. Ready for human review.",
    );
  });

  it("does not touch the PR for states other than ReadyForHumanReview", async () => {
    const client = makeClient();
    const service = new GitHubSyncService(client, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Implementing, prNumber: 10 }));

    expect(client.markPRReady).not.toHaveBeenCalled();
    expect(client.commentOnPR).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  it("maps finding ids to github comment ids and submits an APPROVE review on 'approved'", async () => {
    const client = makeClient();
    client.createPRReviewComment.mockResolvedValue(555);
    const service = new GitHubSyncService(client, makeLogger() as never);

    const findings = [
      { id: "f1", severity: "important", title: "T", details: "D", file: "a.ts", lineHint: 5 },
    ] as never;

    const map = await service.postReviewFindings("org/repo", 10, findings, "approved");

    expect(map.get("f1")).toBe(555);
    expect(client.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      10,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("omits findings whose comment creation returned a falsy id, and requests changes on non-approved verdict", async () => {
    const client = makeClient();
    client.createPRReviewComment.mockResolvedValue(0);
    const service = new GitHubSyncService(client, makeLogger() as never);

    const findings = [
      { id: "f1", severity: "blocker", title: "T", details: "D", file: "a.ts" },
    ] as never;

    const map = await service.postReviewFindings("org/repo", 10, findings, "changes_requested");

    expect(map.has("f1")).toBe(false);
    expect(client.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      10,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
    return {
      executionVersion: 1,
      score: 0.8,
      scoreRationale: "solid",
      summary: "did stuff",
      checks: {
        lint: { status: "pass", details: "clean" },
        typecheck: { status: "fail", details: "errors" },
        tests: { status: "skip", details: "n/a" },
      },
      filesChanged: [],
      notes: [],
      ...overrides,
    } as ExecutionReport;
  }

  it("renders a flat file list when filesChanged is at or below the collapse threshold", async () => {
    const client = makeClient();
    const service = new GitHubSyncService(client, makeLogger() as never);

    await service.postExecutionReportUpdate(
      "org/repo",
      10,
      makeReport({ filesChanged: ["a.ts", "b.ts"], notes: ["note 1"] }),
    );

    const body = client.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("Files changed (2)");
    expect(body).not.toContain("<details>");
    expect(body).toContain("### Notes");
    expect(body).toContain(":white_check_mark: **Lint**");
    expect(body).toContain(":x: **Typecheck**");
    expect(body).toContain(":heavy_minus_sign: **Tests**");
  });

  it("collapses the file list into a <details> block above the threshold and omits the Notes section when empty", async () => {
    const client = makeClient();
    const service = new GitHubSyncService(client, makeLogger() as never);
    const manyFiles = Array.from({ length: 9 }, (_, i) => `file${String(i)}.ts`);

    await service.postExecutionReportUpdate(
      "org/repo",
      10,
      makeReport({ filesChanged: manyFiles, notes: [] }),
    );

    const body = client.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
    expect(body).not.toContain("### Notes");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  it("replies to the mapped GitHub comment for resolutions with a matching findingId", async () => {
    const client = makeClient();
    const service = new GitHubSyncService(client, makeLogger() as never);

    const resolutions = [
      { findingId: "f1", status: "accepted", action: "fixed it", rationale: "was valid" },
      { findingId: "f2", status: "rejected", action: "no change", rationale: "not valid" },
    ] as never;

    await service.postRemediationResolutions("org/repo", 10, resolutions, { f1: 555 });

    expect(client.replyToReviewComment).toHaveBeenCalledTimes(1);
    expect(client.replyToReviewComment).toHaveBeenCalledWith(
      "org/repo",
      10,
      555,
      expect.stringContaining("accepted"),
    );
    expect(client.commentOnPR).toHaveBeenCalledWith(
      "org/repo",
      10,
      expect.stringContaining("AI Remediation Summary"),
    );
  });

  it("uses the unknown-status icon fallback for a status not in the icon map", async () => {
    const client = makeClient();
    const service = new GitHubSyncService(client, makeLogger() as never);

    const resolutions = [
      { findingId: "f1", status: "deferred", action: "later", rationale: "low priority" },
    ] as never;

    await service.postRemediationResolutions("org/repo", 10, resolutions, {});

    expect(client.replyToReviewComment).not.toHaveBeenCalled();
    const body = client.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain(":grey_question:");
  });
});
