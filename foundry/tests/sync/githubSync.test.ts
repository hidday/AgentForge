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
    repo: "test-repo",
    branchName: null,
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

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeGithubClient(overrides: Record<string, unknown> = {}) {
  return {
    markPRReady: vi.fn().mockResolvedValue(undefined),
    commentOnPR: vi.fn().mockResolvedValue(undefined),
    createPRReviewComment: vi.fn().mockResolvedValue(1001),
    submitPRReview: vi.fn().mockResolvedValue(undefined),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "important",
    type: "bug",
    file: "src/foo.ts",
    lineHint: 10,
    title: "Possible bug",
    details: "This looks wrong.",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
    filesChanged: ["src/a.ts", "src/b.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "fail", details: "1 test failed" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Mostly good",
    ...overrides,
  };
}

describe("GitHubSyncService.syncState", () => {
  it("does nothing when the run has no prNumber", async () => {
    const githubClient = makeGithubClient();
    const logger = makeLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    await svc.syncState(makeRun({ prNumber: null, state: RunState.ReadyForHumanReview }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });

  it("does nothing when the run has a PR but is not in ReadyForHumanReview", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ prNumber: 42, state: RunState.Implementing }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when state is ReadyForHumanReview with a prNumber", async () => {
    const githubClient = makeGithubClient();
    const logger = makeLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const run = makeRun({ prNumber: 42, state: RunState.ReadyForHumanReview, repo: "org/repo" });
    await svc.syncState(run);

    expect(githubClient.markPRReady).toHaveBeenCalledWith("org/repo", 42);
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "org/repo",
      42,
      "All AI checks passed. Ready for human review.",
    );
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "org/repo", prNumber: 42 },
      "Marked PR ready for review",
    );
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  it("posts one inline comment per finding and maps finding id to comment id", async () => {
    const githubClient = makeGithubClient({
      createPRReviewComment: vi
        .fn()
        .mockResolvedValueOnce(101)
        .mockResolvedValueOnce(102),
    });
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2", file: "src/bar.ts" })];
    const result = await svc.postReviewFindings("org/repo", 7, findings, "changes_requested");

    expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
      1,
      "org/repo",
      7,
      expect.stringContaining("[IMPORTANT] Possible bug"),
      "src/foo.ts",
      10,
    );
    expect(result.get("f1")).toBe(101);
    expect(result.get("f2")).toBe(102);
    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      7,
      expect.stringContaining("Changes Requested"),
      "REQUEST_CHANGES",
    );
  });

  it("submits an APPROVE review when verdict is approved", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postReviewFindings("org/repo", 7, [], "approved");

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      7,
      expect.stringContaining("Approved"),
      "APPROVE",
    );
  });

  it("skips mapping a finding whose comment creation returns a falsy id", async () => {
    const githubClient = makeGithubClient({
      createPRReviewComment: vi.fn().mockResolvedValue(0),
    });
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const result = await svc.postReviewFindings("org/repo", 7, [makeFinding()], "approved");

    expect(result.size).toBe(0);
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  it("posts a comment including score, checks, and a plain files-changed list under the collapse threshold", async () => {
    const githubClient = makeGithubClient();
    const logger = makeLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const report = makeExecutionReport({ filesChanged: ["src/a.ts", "src/b.ts"] });
    await svc.postExecutionReportUpdate("org/repo", 7, report);

    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    const body = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;

    expect(body).toContain("Score: 80%");
    expect(body).toContain(":white_check_mark: **Lint**");
    expect(body).toContain(":x: **Tests** -- 1 test failed");
    expect(body).toContain("### Files changed (2)");
    expect(body).not.toContain("<details>");
    expect(body).toContain("- `src/a.ts`");
    expect(logger.info).toHaveBeenCalled();
  });

  it("collapses the files-changed section into a <details> block above the threshold", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const files = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);
    await svc.postExecutionReportUpdate("org/repo", 7, makeExecutionReport({ filesChanged: files }));

    const body = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
    expect(body).toContain("</details>");
  });

  it("omits the files-changed section entirely when no files changed", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postExecutionReportUpdate("org/repo", 7, makeExecutionReport({ filesChanged: [] }));

    const body = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(body).not.toContain("Files changed");
  });

  it("includes a Notes section when notes are present, and omits it otherwise", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postExecutionReportUpdate(
      "org/repo",
      7,
      makeExecutionReport({ notes: ["Watch out for X"] }),
    );
    const withNotes = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(withNotes).toContain("### Notes");
    expect(withNotes).toContain("- Watch out for X");

    (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mockClear();
    await svc.postExecutionReportUpdate("org/repo", 7, makeExecutionReport({ notes: [] }));
    const withoutNotes = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(withoutNotes).not.toContain("### Notes");
  });

  it("renders the neutral icon for a skip check status", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postExecutionReportUpdate(
      "org/repo",
      7,
      makeExecutionReport({
        checks: {
          lint: { status: "skip", details: "not run" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      }),
    );
    const body = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(body).toContain(":heavy_minus_sign: **Lint** -- not run");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  it("replies to mapped comments and posts a summary table", async () => {
    const githubClient = makeGithubClient();
    const logger = makeLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const resolutions: ResolutionItem[] = [
      { findingId: "f1", status: "accepted", action: "Fixed it", rationale: "Was a real bug" },
      {
        findingId: "f2",
        status: "rejected",
        action: "No change",
        rationale: "False positive",
      },
    ];
    const commentMap = { f1: 101 };

    await svc.postRemediationResolutions("org/repo", 7, resolutions, commentMap);

    expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(1);
    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "org/repo",
      7,
      101,
      expect.stringContaining(":white_check_mark: **accepted**"),
    );

    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    const summary = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(summary).toContain("## AI Remediation Summary");
    expect(summary).toContain("f1");
    expect(summary).toContain("f2");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ resolutionCount: 2, repliedTo: 1 }),
      "Posted remediation resolutions to PR",
    );
  });

  it("skips replying for resolutions with no mapped GitHub comment id", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const resolutions: ResolutionItem[] = [
      {
        findingId: "unmapped",
        status: "partially_addressed",
        action: "Partial fix",
        rationale: "Only some addressed",
      },
    ];

    await svc.postRemediationResolutions("org/repo", 7, resolutions, {});

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
  });

  it("uses the fallback icon for an unrecognized resolution status", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    const resolutions = [
      {
        findingId: "f1",
        status: "unknown_status" as ResolutionItem["status"],
        action: "Did something",
        rationale: "Because",
      },
    ];

    await svc.postRemediationResolutions("org/repo", 7, resolutions, { f1: 55 });

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "org/repo",
      7,
      55,
      expect.stringContaining(":grey_question:"),
    );
    const summary = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(summary).toContain(":grey_question:");
  });
});
