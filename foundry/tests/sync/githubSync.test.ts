import { describe, it, expect, vi } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Finding } from "../../src/schemas/review.js";
import type { ResolutionItem } from "../../src/schemas/remediation.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { GitHubClient } from "../../src/github/githubClient.js";
import type { Logger } from "../../src/utils/logger.js";

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

function makeMockGithubClient() {
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
    branchName: "feature/x",
    prNumber: 42,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/repo",
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
    title: "Null deref",
    details: "This can throw on null input.",
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
      tests: { status: "pass", details: "42 passed" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "All checks green.",
    ...overrides,
  };
}

describe("GitHubSyncService.syncState", () => {
  it("does nothing when the run has no PR number", async () => {
    const client = makeMockGithubClient();
    const logger = makeMockLogger();
    const svc = new GitHubSyncService(client as unknown as GitHubClient, logger as unknown as Logger);

    await svc.syncState(makeRun({ prNumber: null, state: RunState.ReadyForHumanReview }));

    expect(client.markPRReady).not.toHaveBeenCalled();
    expect(client.commentOnPR).not.toHaveBeenCalled();
  });

  it("does nothing when the run state is not ReadyForHumanReview", async () => {
    const client = makeMockGithubClient();
    const logger = makeMockLogger();
    const svc = new GitHubSyncService(client as unknown as GitHubClient, logger as unknown as Logger);

    await svc.syncState(makeRun({ prNumber: 7, state: RunState.Implementing }));

    expect(client.markPRReady).not.toHaveBeenCalled();
    expect(client.commentOnPR).not.toHaveBeenCalled();
  });

  it("marks the PR ready and comments when the run is ReadyForHumanReview", async () => {
    const client = makeMockGithubClient();
    const logger = makeMockLogger();
    const svc = new GitHubSyncService(client as unknown as GitHubClient, logger as unknown as Logger);

    const run = makeRun({ repo: "org/repo", prNumber: 7, state: RunState.ReadyForHumanReview });
    await svc.syncState(run);

    expect(client.markPRReady).toHaveBeenCalledWith("org/repo", 7);
    expect(client.commentOnPR).toHaveBeenCalledWith(
      "org/repo",
      7,
      "All AI checks passed. Ready for human review.",
    );
    expect(logger.debug).toHaveBeenCalledWith(
      { repo: "org/repo", prNumber: 7 },
      "Marked PR ready for review",
    );
  });
});

describe("GitHubSyncService.postReviewFindings", () => {
  it("posts inline comments, maps returned comment ids, and submits an APPROVE review", async () => {
    const client = makeMockGithubClient();
    client.createPRReviewComment
      .mockResolvedValueOnce(101)
      .mockResolvedValueOnce(0) // falsy -> not mapped
      .mockResolvedValueOnce(103);
    const logger = makeMockLogger();
    const svc = new GitHubSyncService(client as unknown as GitHubClient, logger as unknown as Logger);

    const findings = [
      makeFinding({ id: "f1", severity: "blocker", title: "Bug A", details: "details A", file: "a.ts", lineHint: 10 }),
      makeFinding({ id: "f2", severity: "nit", title: "Bug B", details: "details B", file: "b.ts" }),
      makeFinding({ id: "f3", severity: "suggestion", title: "Bug C", details: "details C", file: "c.ts", lineHint: 3 }),
    ];

    const result = await svc.postReviewFindings("org/repo", 5, findings, "approved");

    expect(client.createPRReviewComment).toHaveBeenNthCalledWith(
      1,
      "org/repo",
      5,
      "**[BLOCKER]** Bug A\n\ndetails A",
      "a.ts",
      10,
    );
    expect(client.createPRReviewComment).toHaveBeenNthCalledWith(
      2,
      "org/repo",
      5,
      "**[NIT]** Bug B\n\ndetails B",
      "b.ts",
      undefined,
    );

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(2);
    expect(result.get("f1")).toBe(101);
    expect(result.get("f2")).toBeUndefined();
    expect(result.get("f3")).toBe(103);

    expect(client.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      5,
      "AI Code Review: Approved\n\n3 finding(s) posted as inline comments.",
      "APPROVE",
    );
    expect(logger.info).toHaveBeenCalledWith(
      { repo: "org/repo", prNumber: 5, findingsCount: 3, verdict: "approved", mappedComments: 2 },
      "Posted review findings as PR review comments",
    );
  });

  it("submits a REQUEST_CHANGES review for a non-approved verdict", async () => {
    const client = makeMockGithubClient();
    client.createPRReviewComment.mockResolvedValue(1);
    const svc = new GitHubSyncService(
      client as unknown as GitHubClient,
      makeMockLogger() as unknown as Logger,
    );

    await svc.postReviewFindings("org/repo", 5, [makeFinding()], "changes_requested");

    expect(client.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      5,
      "AI Code Review: Changes Requested\n\n1 finding(s) posted as inline comments.",
      "REQUEST_CHANGES",
    );
  });

  it("returns an empty map and posts a zero-finding review summary when there are no findings", async () => {
    const client = makeMockGithubClient();
    const svc = new GitHubSyncService(
      client as unknown as GitHubClient,
      makeMockLogger() as unknown as Logger,
    );

    const result = await svc.postReviewFindings("org/repo", 5, [], "approved");

    expect(result.size).toBe(0);
    expect(client.createPRReviewComment).not.toHaveBeenCalled();
    expect(client.submitPRReview).toHaveBeenCalledWith(
      "org/repo",
      5,
      "AI Code Review: Approved\n\n0 finding(s) posted as inline comments.",
      "APPROVE",
    );
  });
});

describe("GitHubSyncService.postExecutionReportUpdate", () => {
  it("renders check icons, a non-collapsed file list, and no notes section", async () => {
    const client = makeMockGithubClient();
    const logger = makeMockLogger();
    const svc = new GitHubSyncService(client as unknown as GitHubClient, logger as unknown as Logger);

    const report = makeExecutionReport({
      executionVersion: 2,
      score: 0.8333,
      scoreRationale: "Mostly good.",
      summary: "Did the work.",
      filesChanged: ["a.ts", "b.ts"],
      checks: {
        lint: { status: "pass", details: "clean" },
        typecheck: { status: "fail", details: "2 errors" },
        tests: { status: "skip", details: "not run" },
      },
      notes: [],
    });

    await svc.postExecutionReportUpdate("org/repo", 9, report);

    expect(client.commentOnPR).toHaveBeenCalledTimes(1);
    const [repo, prNumber, body] = client.commentOnPR.mock.calls[0] as [string, number, string];
    expect(repo).toBe("org/repo");
    expect(prNumber).toBe(9);
    expect(body).toBe(
      [
        "## AI Execution Report (v2) -- Score: 83%",
        "",
        "*Mostly good.*",
        "",
        "Did the work.",
        "",
        "### Checks",
        "- :white_check_mark: **Lint** -- clean\n- :x: **Typecheck** -- 2 errors\n- :heavy_minus_sign: **Tests** -- not run",
        "\n### Files changed (2)\n- `a.ts`\n- `b.ts`",
        "",
      ].join("\n"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      { repo: "org/repo", prNumber: 9, executionVersion: 2, score: 0.8333, filesChanged: 2 },
      "Posted execution report update to PR",
    );
  });

  it("collapses the file list behind <details> when more than 8 files changed", async () => {
    const client = makeMockGithubClient();
    const svc = new GitHubSyncService(
      client as unknown as GitHubClient,
      makeMockLogger() as unknown as Logger,
    );
    const filesChanged = Array.from({ length: 9 }, (_, i) => `file${i}.ts`);
    const report = makeExecutionReport({ filesChanged });

    await svc.postExecutionReportUpdate("org/repo", 9, report);

    const [, , body] = client.commentOnPR.mock.calls[0] as [string, number, string];
    expect(body).toContain("<details>");
    expect(body).toContain("<summary><strong>Files changed (9)</strong></summary>");
    expect(body).toContain("- `file0.ts`");
    expect(body).toContain("</details>");
  });

  it("omits the files section entirely when no files changed, and includes a notes section when present", async () => {
    const client = makeMockGithubClient();
    const svc = new GitHubSyncService(
      client as unknown as GitHubClient,
      makeMockLogger() as unknown as Logger,
    );
    const report = makeExecutionReport({ filesChanged: [], notes: ["Skipped e2e tests.", "Manual QA needed."] });

    await svc.postExecutionReportUpdate("org/repo", 9, report);

    const [, , body] = client.commentOnPR.mock.calls[0] as [string, number, string];
    expect(body).not.toContain("Files changed");
    expect(body).toContain("### Notes\n- Skipped e2e tests.\n- Manual QA needed.");
  });
});

describe("GitHubSyncService.postRemediationResolutions", () => {
  it("replies only to findings present in the comment map, and posts a full summary table", async () => {
    const client = makeMockGithubClient();
    const logger = makeMockLogger();
    const svc = new GitHubSyncService(client as unknown as GitHubClient, logger as unknown as Logger);

    const resolutions: ResolutionItem[] = [
      { findingId: "f1", status: "accepted", action: "Fixed the null check", rationale: "Was a real bug" },
      { findingId: "f2", status: "rejected", action: "No change", rationale: "False positive" },
      { findingId: "f3", status: "partially_addressed", action: "Partial fix", rationale: "Time constraints" },
    ];
    const commentMap: Record<string, number> = { f1: 101, f3: 103 }; // f2 has no GH comment

    await svc.postRemediationResolutions("org/repo", 9, resolutions, commentMap);

    expect(client.replyToReviewComment).toHaveBeenCalledTimes(2);
    expect(client.replyToReviewComment).toHaveBeenNthCalledWith(
      1,
      "org/repo",
      9,
      101,
      ":white_check_mark: **accepted**\n\n**Action:** Fixed the null check\n**Rationale:** Was a real bug",
    );
    expect(client.replyToReviewComment).toHaveBeenNthCalledWith(
      2,
      "org/repo",
      9,
      103,
      ":warning: **partially addressed**\n\n**Action:** Partial fix\n**Rationale:** Time constraints",
    );

    expect(client.commentOnPR).toHaveBeenCalledWith(
      "org/repo",
      9,
      [
        "## AI Remediation Summary",
        "",
        "| Finding | Status | Action | Rationale |",
        "|---------|--------|--------|-----------|",
        "| :white_check_mark: **f1** | accepted | Fixed the null check | Was a real bug |",
        "| :no_entry_sign: **f2** | rejected | No change | False positive |",
        "| :warning: **f3** | partially addressed | Partial fix | Time constraints |",
      ].join("\n"),
    );

    expect(logger.info).toHaveBeenCalledWith(
      { repo: "org/repo", prNumber: 9, resolutionCount: 3, repliedTo: 2 },
      "Posted remediation resolutions to PR",
    );
  });

  it("falls back to a grey-question icon for an unrecognized status", async () => {
    const client = makeMockGithubClient();
    const svc = new GitHubSyncService(
      client as unknown as GitHubClient,
      makeMockLogger() as unknown as Logger,
    );
    const resolutions = [
      {
        findingId: "f1",
        status: "unknown_status" as ResolutionItem["status"],
        action: "did something",
        rationale: "because",
      },
    ];

    await svc.postRemediationResolutions("org/repo", 9, resolutions, { f1: 55 });

    expect(client.replyToReviewComment).toHaveBeenCalledWith(
      "org/repo",
      9,
      55,
      ":grey_question: **unknown status**\n\n**Action:** did something\n**Rationale:** because",
    );
    const [, , body] = client.commentOnPR.mock.calls[0] as [string, number, string];
    expect(body).toContain("| :grey_question: **f1** | unknown status | did something | because |");
  });

  it("posts only the summary and skips replies when the comment map is empty", async () => {
    const client = makeMockGithubClient();
    const svc = new GitHubSyncService(
      client as unknown as GitHubClient,
      makeMockLogger() as unknown as Logger,
    );
    const resolutions: ResolutionItem[] = [
      { findingId: "f1", status: "accepted", action: "x", rationale: "y" },
    ];

    await svc.postRemediationResolutions("org/repo", 9, resolutions, {});

    expect(client.replyToReviewComment).not.toHaveBeenCalled();
    expect(client.commentOnPR).toHaveBeenCalledTimes(1);
  });
});
