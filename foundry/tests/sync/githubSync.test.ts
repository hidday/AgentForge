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
    linearIssueId: "li-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "agentforge",
    branchName: null,
    prNumber: 10,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/repo",
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
    createPRReviewComment: vi.fn().mockResolvedValue(0),
    submitPRReview: vi.fn().mockResolvedValue(undefined),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
  };
}

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "summary",
    filesChanged: [],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "pass", details: "all green" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "good",
    ...overrides,
  };
}

describe("GitHubSyncService.syncState", () => {
  it("is a no-op when the run has no PR number", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.syncState(makeRun({ prNumber: null, state: RunState.ReadyForHumanReview }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when the run reaches ReadyForHumanReview", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.ReadyForHumanReview }));

    expect(githubClient.markPRReady).toHaveBeenCalledWith("agentforge", 10);
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "agentforge",
      10,
      "All AI checks passed. Ready for human review.",
    );
  });

  it("does nothing for other states even with a PR number present", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Implementing }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  const findings: Finding[] = [
    { id: "f1", severity: "blocker", type: "bug", file: "a.ts", lineHint: 10, title: "t1", details: "d1" },
    { id: "f2", severity: "nit", type: "style", file: "b.ts", title: "t2", details: "d2" },
  ];

  it("posts an inline comment per finding and maps returned comment ids", async () => {
    const githubClient = makeGithubClient();
    githubClient.createPRReviewComment.mockResolvedValueOnce(201).mockResolvedValueOnce(0);
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const map = await service.postReviewFindings("org/repo", 1, findings, "changes_requested");

    expect(map.get("f1")).toBe(201);
    expect(map.has("f2")).toBe(false);
    expect(githubClient.createPRReviewComment).toHaveBeenCalledWith(
      "org/repo",
      1,
      expect.stringContaining("[BLOCKER]"),
      "a.ts",
      10,
    );
  });

  it("submits an APPROVE review when the verdict is approved", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postReviewFindings("org/repo", 1, [], "approved");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      1,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("submits a REQUEST_CHANGES review when the verdict is not approved", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postReviewFindings("org/repo", 1, findings, "changes_requested");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      1,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  it("renders a short file list inline when under the collapse threshold", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate(
      "org/repo",
      1,
      makeExecutionReport({ filesChanged: ["a.ts", "b.ts"] }),
    );

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("Files changed (2)");
    expect(body).not.toContain("<details>");
  });

  it("collapses the file list into a <details> block above the threshold", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const files = Array.from({ length: 9 }, (_, i) => `file${String(i)}.ts`);

    await service.postExecutionReportUpdate("org/repo", 1, makeExecutionReport({ filesChanged: files }));

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
  });

  it("omits the files and notes sections when both are empty", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate("org/repo", 1, makeExecutionReport({ filesChanged: [], notes: [] }));

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).not.toContain("Files changed");
    expect(body).not.toContain("### Notes");
  });

  it("includes a notes section when notes are present", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate(
      "org/repo",
      1,
      makeExecutionReport({ notes: ["Fixed a bug"] }),
    );

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("### Notes");
    expect(body).toContain("Fixed a bug");
  });

  it("renders a fail icon for a failing check", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postExecutionReportUpdate(
      "org/repo",
      1,
      makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "errors" },
          typecheck: { status: "skip", details: "skipped" },
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
  const resolutions: ResolutionItem[] = [
    { findingId: "f1", status: "accepted", action: "fixed it", rationale: "was a real bug" },
    { findingId: "f2", status: "rejected", action: "no change", rationale: "out of scope" },
    { findingId: "f3", status: "partially_addressed", action: "partial fix", rationale: "time" },
  ];

  it("replies on each comment that has a mapped GitHub comment id", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions("org/repo", 1, resolutions, { f1: 500 });

    expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(1);
    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "org/repo",
      1,
      500,
      expect.stringContaining("accepted"),
    );
  });

  it("skips replying for findings without a mapped comment id", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await service.postRemediationResolutions("org/repo", 1, resolutions, {});

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
  });

  it("posts a summary table covering all resolutions, including an unknown status icon", async () => {
    const githubClient = makeGithubClient();
    const service = new GitHubSyncService(githubClient as never, makeLogger() as never);
    const withUnknown: ResolutionItem[] = [
      ...resolutions,
      { findingId: "f4", status: "accepted", action: "x", rationale: "y" },
    ];

    await service.postRemediationResolutions("org/repo", 1, withUnknown, {});

    const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summary).toContain("AI Remediation Summary");
    expect(summary).toContain("f1");
    expect(summary).toContain("f4");
  });
});
