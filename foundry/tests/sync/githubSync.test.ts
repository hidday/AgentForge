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

function buildGithubClient(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

function buildLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "blocker",
    type: "bug",
    file: "src/a.ts",
    lineHint: 10,
    title: "Null deref",
    details: "This may throw",
    ...overrides,
  };
}

function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
  return {
    findingId: "f1",
    status: "accepted",
    action: "Fixed the null check",
    rationale: "It was indeed unsafe",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "pass", details: "all green" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks solid",
    ...overrides,
  };
}

describe("GitHubSyncService.syncState", () => {
  it("does nothing when run.prNumber is null", async () => {
    const githubClient = buildGithubClient();
    const logger = buildLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const run = makeRun({ prNumber: null, state: RunState.ReadyForHumanReview });
    await svc.syncState(run);

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });

  it("does nothing when run.prNumber is undefined", async () => {
    const githubClient = buildGithubClient();
    const logger = buildLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const run = makeRun({ prNumber: undefined as unknown as null, state: RunState.ReadyForHumanReview });
    await svc.syncState(run);

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });

  it("marks PR ready and comments when state is ReadyForHumanReview", async () => {
    const githubClient = buildGithubClient();
    const logger = buildLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const run = makeRun({ prNumber: 42, state: RunState.ReadyForHumanReview, repo: "acme/repo" });
    await svc.syncState(run);

    expect(githubClient.markPRReady).toHaveBeenCalledWith("acme/repo", 42);
    expect(githubClient.commentOnPR).toHaveBeenCalledWith(
      "acme/repo",
      42,
      "All AI checks passed. Ready for human review.",
    );
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "acme/repo", prNumber: 42 },
      "Marked PR ready for review",
    );
  });

  it("does nothing when prNumber is set but state is not ReadyForHumanReview", async () => {
    const githubClient = buildGithubClient();
    const logger = buildLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const run = makeRun({ prNumber: 42, state: RunState.Implementing });
    await svc.syncState(run);

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  it("posts one review comment per finding and returns only truthy comment ids", async () => {
    const createPRReviewComment = vi
      .fn()
      .mockResolvedValueOnce(1001)
      .mockResolvedValueOnce(0);
    const githubClient = buildGithubClient({ createPRReviewComment });
    const logger = buildLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const findings = [
      makeFinding({ id: "f1", severity: "blocker", title: "Issue one", details: "Detail one" }),
      makeFinding({ id: "f2", severity: "nit", title: "Issue two", details: "Detail two" }),
    ];

    const result = await svc.postReviewFindings("acme/repo", 7, findings, "changes_requested");

    expect(createPRReviewComment).toHaveBeenCalledTimes(2);
    expect(createPRReviewComment).toHaveBeenNthCalledWith(
      1,
      "acme/repo",
      7,
      "**[BLOCKER]** Issue one\n\nDetail one",
      "src/a.ts",
      10,
    );
    expect(createPRReviewComment).toHaveBeenNthCalledWith(
      2,
      "acme/repo",
      7,
      "**[NIT]** Issue two\n\nDetail two",
      "src/a.ts",
      10,
    );

    expect(result.size).toBe(1);
    expect(result.get("f1")).toBe(1001);
    expect(result.has("f2")).toBe(false);
  });

  it("submits APPROVE event when verdict is approved", async () => {
    const createPRReviewComment = vi.fn().mockResolvedValue(2002);
    const submitPRReview = vi.fn().mockResolvedValue(undefined);
    const githubClient = buildGithubClient({ createPRReviewComment, submitPRReview });
    const logger = buildLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const findings = [makeFinding({ id: "f1" })];
    await svc.postReviewFindings("acme/repo", 7, findings, "approved");

    expect(submitPRReview).toHaveBeenCalledWith(
      "acme/repo",
      7,
      "AI Code Review: Approved\n\n1 finding(s) posted as inline comments.",
      "APPROVE",
    );
    expect(logger.info).toHaveBeenCalledWith(
      {
        repo: "acme/repo",
        prNumber: 7,
        findingsCount: 1,
        verdict: "approved",
        mappedComments: 1,
      },
      "Posted review findings as PR review comments",
    );
  });

  it("submits REQUEST_CHANGES event when verdict is not approved", async () => {
    const createPRReviewComment = vi.fn().mockResolvedValue(3003);
    const submitPRReview = vi.fn().mockResolvedValue(undefined);
    const githubClient = buildGithubClient({ createPRReviewComment, submitPRReview });
    const logger = buildLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const findings = [makeFinding({ id: "f1" })];
    await svc.postReviewFindings("acme/repo", 7, findings, "changes_requested");

    expect(submitPRReview).toHaveBeenCalledWith(
      "acme/repo",
      7,
      "AI Code Review: Changes Requested\n\n1 finding(s) posted as inline comments.",
      "REQUEST_CHANGES",
    );
  });

  it("handles an empty findings array", async () => {
    const githubClient = buildGithubClient();
    const logger = buildLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const result = await svc.postReviewFindings("acme/repo", 7, [], "approved");

    expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/repo",
      7,
      "AI Code Review: Approved\n\n0 finding(s) posted as inline comments.",
      "APPROVE",
    );
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  it("collapses files inline when <= 8 files changed and includes notes when present", async () => {
    const githubClient = buildGithubClient();
    const logger = buildLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const report = makeExecutionReport({
      executionVersion: 2,
      score: 0.75,
      filesChanged: ["src/a.ts", "src/b.ts"],
      notes: ["Note one", "Note two"],
      checks: {
        lint: { status: "pass", details: "clean" },
        typecheck: { status: "fail", details: "type errors" },
        tests: { status: "skip", details: "not run" },
      },
    });

    await svc.postExecutionReportUpdate("acme/repo", 7, report);

    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    const [repoArg, prArg, body] = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, number, string];
    expect(repoArg).toBe("acme/repo");
    expect(prArg).toBe(7);

    expect(body).toContain("## AI Execution Report (v2) -- Score: 75%");
    expect(body).toContain(":white_check_mark: **Lint** -- clean");
    expect(body).toContain(":x: **Typecheck** -- type errors");
    expect(body).toContain(":heavy_minus_sign: **Tests** -- not run");
    expect(body).toContain("### Files changed (2)");
    expect(body).toContain("- `src/a.ts`");
    expect(body).toContain("- `src/b.ts`");
    expect(body).not.toContain("<details>");
    expect(body).toContain("### Notes");
    expect(body).toContain("- Note one");
    expect(body).toContain("- Note two");

    expect(logger.info).toHaveBeenCalledWith(
      {
        repo: "acme/repo",
        prNumber: 7,
        executionVersion: 2,
        score: 0.75,
        filesChanged: 2,
      },
      "Posted execution report update to PR",
    );
  });

  it("uses a collapsible <details> block when > 8 files changed", async () => {
    const githubClient = buildGithubClient();
    const logger = buildLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const files = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);
    const report = makeExecutionReport({ filesChanged: files });

    await svc.postExecutionReportUpdate("acme/repo", 7, report);

    const body = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("<summary><strong>Files changed (9)</strong></summary>");
    expect(body).toContain("</details>");
    expect(body).toContain("- `src/file0.ts`");
  });

  it("omits the files section entirely when filesChanged is empty", async () => {
    const githubClient = buildGithubClient();
    const logger = buildLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const report = makeExecutionReport({ filesChanged: [] });
    await svc.postExecutionReportUpdate("acme/repo", 7, report);

    const body = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(body).not.toContain("Files changed");
    expect(body).not.toContain("<details>");
  });

  it("omits the notes section entirely when notes is empty", async () => {
    const githubClient = buildGithubClient();
    const logger = buildLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const report = makeExecutionReport({ notes: [] });
    await svc.postExecutionReportUpdate("acme/repo", 7, report);

    const body = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(body).not.toContain("### Notes");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  it("posts a reply when findingId is in commentMap, and skips when it is not, but both appear in the summary table", async () => {
    const githubClient = buildGithubClient();
    const logger = buildLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const resolutions = [
      makeResolution({
        findingId: "f1",
        status: "accepted",
        action: "Fixed it",
        rationale: "Was broken",
      }),
      makeResolution({
        findingId: "f2",
        status: "rejected",
        action: "No change",
        rationale: "Not applicable",
      }),
    ];
    const commentMap: Record<string, number> = { f1: 1001 };

    await svc.postRemediationResolutions("acme/repo", 7, resolutions, commentMap);

    expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(1);
    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "acme/repo",
      7,
      1001,
      [
        ":white_check_mark: **accepted**",
        "",
        "**Action:** Fixed it",
        "**Rationale:** Was broken",
      ].join("\n"),
    );

    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    const summaryBody = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(summaryBody).toContain("## AI Remediation Summary");
    expect(summaryBody).toContain("| :white_check_mark: **f1** | accepted | Fixed it | Was broken |");
    expect(summaryBody).toContain(
      "| :no_entry_sign: **f2** | rejected | No change | Not applicable |",
    );

    expect(logger.info).toHaveBeenCalledWith(
      {
        repo: "acme/repo",
        prNumber: 7,
        resolutionCount: 2,
        repliedTo: 1,
      },
      "Posted remediation resolutions to PR",
    );
  });

  it("uses the correct icon for each known status and falls back to grey_question for unrecognized statuses", async () => {
    const githubClient = buildGithubClient();
    const logger = buildLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const resolutions = [
      makeResolution({ findingId: "f1", status: "accepted" }),
      makeResolution({ findingId: "f2", status: "rejected" }),
      makeResolution({ findingId: "f3", status: "partially_addressed" }),
      makeResolution({
        findingId: "f4",
        status: "unknown_status" as ResolutionItem["status"],
      }),
    ];
    const commentMap: Record<string, number> = {};

    await svc.postRemediationResolutions("acme/repo", 7, resolutions, commentMap);

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();

    const summaryBody = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(summaryBody).toContain("| :white_check_mark: **f1** | accepted |");
    expect(summaryBody).toContain("| :no_entry_sign: **f2** | rejected |");
    expect(summaryBody).toContain("| :warning: **f3** | partially addressed |");
    expect(summaryBody).toContain("| :grey_question: **f4** | unknown_status |");
  });

  it("does not reply when commentMap has a falsy (0) value for the finding", async () => {
    const githubClient = buildGithubClient();
    const logger = buildLogger();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const resolutions = [makeResolution({ findingId: "f1" })];
    const commentMap: Record<string, number> = { f1: 0 };

    await svc.postRemediationResolutions("acme/repo", 7, resolutions, commentMap);

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
  });
});
