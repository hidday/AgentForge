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

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "blocker",
    type: "bug",
    file: "src/foo.ts",
    lineHint: 10,
    title: "Some bug",
    details: "Details here",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Did the thing",
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

function buildDeps() {
  const githubClient = {
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

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return { githubClient, logger };
}

describe("GitHubSyncService.syncState", () => {
  it("does nothing when the run has no prNumber", async () => {
    const { githubClient, logger } = buildDeps();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    await svc.syncState(makeRun({ prNumber: null }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it("does nothing when the run has a prNumber but is not ReadyForHumanReview", async () => {
    const { githubClient, logger } = buildDeps();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    await svc.syncState(makeRun({ prNumber: 42, state: RunState.Implementing }));

    expect(githubClient.markPRReady).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when state is ReadyForHumanReview", async () => {
    const { githubClient, logger } = buildDeps();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    await svc.syncState(
      makeRun({ prNumber: 42, repo: "acme/repo", state: RunState.ReadyForHumanReview }),
    );

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
});

describe("GitHubSyncService.postReviewFindings", () => {
  it("posts an inline comment per finding, maps ids to comment ids, and submits an APPROVE review", async () => {
    const { githubClient, logger } = buildDeps();
    githubClient.createPRReviewComment.mockResolvedValueOnce(101).mockResolvedValueOnce(102);
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const findings = [
      makeFinding({ id: "f1", severity: "blocker", title: "Bug A" }),
      makeFinding({ id: "f2", severity: "nit", title: "Bug B", file: "src/bar.ts", lineHint: 5 }),
    ];

    const result = await svc.postReviewFindings("acme/repo", 7, findings, "approved");

    expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
      1,
      "acme/repo",
      7,
      "**[BLOCKER]** Bug A\n\nDetails here",
      "src/foo.ts",
      10,
    );
    expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
      2,
      "acme/repo",
      7,
      "**[NIT]** Bug B\n\nDetails here",
      "src/bar.ts",
      5,
    );

    expect(result.get("f1")).toBe(101);
    expect(result.get("f2")).toBe(102);
    expect(result.size).toBe(2);

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/repo",
      7,
      "AI Code Review: Approved\n\n2 finding(s) posted as inline comments.",
      "APPROVE",
    );

    expect(logger.info).toHaveBeenCalledWith(
      {
        repo: "acme/repo",
        prNumber: 7,
        findingsCount: 2,
        verdict: "approved",
        mappedComments: 2,
      },
      "Posted review findings as PR review comments",
    );
  });

  it("submits REQUEST_CHANGES for a non-approved verdict and omits findings without a returned comment id", async () => {
    const { githubClient, logger } = buildDeps();
    githubClient.createPRReviewComment.mockResolvedValueOnce(0);
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const findings = [makeFinding({ id: "f1" })];
    const result = await svc.postReviewFindings("acme/repo", 7, findings, "changes_requested");

    expect(result.has("f1")).toBe(false);
    expect(result.size).toBe(0);

    expect(githubClient.submitPRReview).toHaveBeenCalledWith(
      "acme/repo",
      7,
      "AI Code Review: Changes Requested\n\n1 finding(s) posted as inline comments.",
      "REQUEST_CHANGES",
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        mappedComments: 0,
        findingsCount: 1,
        verdict: "changes_requested",
      }),
      "Posted review findings as PR review comments",
    );
  });

  it("handles an empty findings list", async () => {
    const { githubClient, logger } = buildDeps();
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
  it("renders checks with pass/fail/skip icons and an inline files-changed section for <= 8 files", async () => {
    const { githubClient, logger } = buildDeps();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const report = makeExecutionReport({
      executionVersion: 2,
      score: 0.75,
      scoreRationale: "Mostly good",
      summary: "Summary text",
      filesChanged: ["a.ts", "b.ts"],
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "fail", details: "type error" },
        tests: { status: "skip", details: "skipped" },
      },
      notes: [],
    });

    await svc.postExecutionReportUpdate("acme/repo", 9, report);

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(githubClient.commentOnPR).toHaveBeenCalledWith("acme/repo", 9, expect.any(String));
    expect(body).toContain("## AI Execution Report (v2) -- Score: 75%");
    expect(body).toContain("*Mostly good*");
    expect(body).toContain("Summary text");
    expect(body).toContain("- :white_check_mark: **Lint** -- ok");
    expect(body).toContain("- :x: **Typecheck** -- type error");
    expect(body).toContain("- :heavy_minus_sign: **Tests** -- skipped");
    expect(body).toContain("### Files changed (2)");
    expect(body).toContain("- `a.ts`");
    expect(body).toContain("- `b.ts`");
    expect(body).not.toContain("<details>");
    expect(body).not.toContain("### Notes");

    expect(logger.info).toHaveBeenCalledWith(
      {
        repo: "acme/repo",
        prNumber: 9,
        executionVersion: 2,
        score: 0.75,
        filesChanged: 2,
      },
      "Posted execution report update to PR",
    );
  });

  it("collapses the files-changed section into <details> when there are more than 8 files", async () => {
    const { githubClient, logger } = buildDeps();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const nineFiles = Array.from({ length: 9 }, (_, i) => `file${String(i)}.ts`);
    const report = makeExecutionReport({
      filesChanged: nineFiles,
      notes: ["Note one", "Note two"],
    });

    await svc.postExecutionReportUpdate("acme/repo", 9, report);

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("<summary><strong>Files changed (9)</strong></summary>");
    expect(body).toContain("- `file0.ts`");
    expect(body).toContain("- `file8.ts`");
    expect(body).toContain("</details>");
    expect(body).toContain("### Notes");
    expect(body).toContain("- Note one");
    expect(body).toContain("- Note two");
    void logger;
  });

  it("omits the files-changed section entirely when filesChanged is empty", async () => {
    const { githubClient } = buildDeps();
    const svc = new GitHubSyncService(githubClient as never, buildDeps().logger as never);

    const report = makeExecutionReport({ filesChanged: [] });
    await svc.postExecutionReportUpdate("acme/repo", 9, report);

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).not.toContain("Files changed");
    expect(body).not.toContain("<details>");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
    return {
      findingId: "f1",
      status: "accepted",
      action: "Fixed it",
      rationale: "Because it was wrong",
      ...overrides,
    };
  }

  it("replies to each mapped finding's comment and posts a full summary table", async () => {
    const { githubClient, logger } = buildDeps();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const resolutions = [
      makeResolution({ findingId: "f1", status: "accepted", action: "Fixed", rationale: "R1" }),
      makeResolution({ findingId: "f2", status: "rejected", action: "No change", rationale: "R2" }),
      makeResolution({
        findingId: "f3",
        status: "partially_addressed",
        action: "Partly fixed",
        rationale: "R3",
      }),
    ];
    const commentMap: Record<string, number> = { f1: 201, f2: 202 };

    await svc.postRemediationResolutions("acme/repo", 9, resolutions, commentMap);

    expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(2);
    expect(githubClient.replyToReviewComment).toHaveBeenNthCalledWith(
      1,
      "acme/repo",
      9,
      201,
      ":white_check_mark: **accepted**\n\n**Action:** Fixed\n**Rationale:** R1",
    );
    expect(githubClient.replyToReviewComment).toHaveBeenNthCalledWith(
      2,
      "acme/repo",
      9,
      202,
      ":no_entry_sign: **rejected**\n\n**Action:** No change\n**Rationale:** R2",
    );

    const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summaryBody).toContain("## AI Remediation Summary");
    expect(summaryBody).toContain("| :white_check_mark: **f1** | accepted | Fixed | R1 |");
    expect(summaryBody).toContain("| :no_entry_sign: **f2** | rejected | No change | R2 |");
    expect(summaryBody).toContain("| :warning: **f3** | partially addressed | Partly fixed | R3 |");

    expect(logger.info).toHaveBeenCalledWith(
      {
        repo: "acme/repo",
        prNumber: 9,
        resolutionCount: 3,
        repliedTo: 2,
      },
      "Posted remediation resolutions to PR",
    );
  });

  it("skips replying when a resolution has no mapped github comment id", async () => {
    const { githubClient, logger } = buildDeps();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    const resolutions = [makeResolution({ findingId: "unmapped" })];
    await svc.postRemediationResolutions("acme/repo", 9, resolutions, {});

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ repliedTo: 0, resolutionCount: 1 }),
      "Posted remediation resolutions to PR",
    );
  });

  it("falls back to the grey-question icon for an unrecognized status", async () => {
    const { githubClient } = buildDeps();
    const svc = new GitHubSyncService(githubClient as never, buildDeps().logger as never);

    const resolutions = [
      // Cast to bypass the ResolutionStatus union so we can exercise the `?? ":grey_question:"` fallback.
      makeResolution({ findingId: "f1", status: "unknown_status" as ResolutionItem["status"] }),
    ];
    const commentMap: Record<string, number> = { f1: 301 };

    await svc.postRemediationResolutions("acme/repo", 9, resolutions, commentMap);

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "acme/repo",
      9,
      301,
      expect.stringContaining(":grey_question:"),
    );
    const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summaryBody).toContain(":grey_question:");
  });

  it("handles an empty resolutions list", async () => {
    const { githubClient, logger } = buildDeps();
    const svc = new GitHubSyncService(githubClient as never, logger as never);

    await svc.postRemediationResolutions("acme/repo", 9, [], {});

    expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(summaryBody).toBe(
      [
        "## AI Remediation Summary",
        "",
        "| Finding | Status | Action | Rationale |",
        "|---------|--------|--------|-----------|",
      ].join("\n"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ resolutionCount: 0, repliedTo: 0 }),
      "Posted remediation resolutions to PR",
    );
  });
});
