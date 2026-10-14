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
    branchName: null,
    prNumber: null,
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

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "No issues" },
      typecheck: { status: "pass", details: "No issues" },
      tests: { status: "pass", details: "All green" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks solid",
    ...overrides,
  };
}

describe("GitHubSyncService", () => {
  let githubClient: ReturnType<typeof makeGithubClient>;
  let logger: ReturnType<typeof makeLogger>;
  let service: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGithubClient();
    logger = makeLogger();
    service = new GitHubSyncService(githubClient as never, logger as never);
  });

  describe("syncState", () => {
    it("does nothing when the run has no PR number", async () => {
      const run = makeRun({ prNumber: null, state: RunState.ReadyForHumanReview });
      await service.syncState(run);

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("does nothing when the run has a PR number but is not ReadyForHumanReview", async () => {
      const run = makeRun({ prNumber: 42, state: RunState.Implementing });
      await service.syncState(run);

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when state is ReadyForHumanReview", async () => {
      const run = makeRun({ prNumber: 42, repo: "acme/widgets", state: RunState.ReadyForHumanReview });
      await service.syncState(run);

      expect(githubClient.markPRReady).toHaveBeenCalledWith("acme/widgets", 42);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        "All AI checks passed. Ready for human review.",
      );
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 42 },
        "Marked PR ready for review",
      );
    });
  });

  describe("postReviewFindings", () => {
    const findings: Finding[] = [
      {
        id: "f1",
        severity: "blocker",
        type: "bug",
        file: "src/a.ts",
        lineHint: 10,
        title: "Null deref",
        details: "This can throw.",
      },
      {
        id: "f2",
        severity: "nit",
        type: "style",
        file: "src/b.ts",
        title: "Naming",
        details: "Rename this.",
      },
    ];

    it("posts an inline comment per finding, maps ids to comment ids, and submits a REQUEST_CHANGES review", async () => {
      githubClient.createPRReviewComment
        .mockResolvedValueOnce(111)
        .mockResolvedValueOnce(222);

      const commentMap = await service.postReviewFindings(
        "acme/widgets",
        42,
        findings,
        "changes_requested",
      );

      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        1,
        "acme/widgets",
        42,
        "**[BLOCKER]** Null deref\n\nThis can throw.",
        "src/a.ts",
        10,
      );
      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        2,
        "acme/widgets",
        42,
        "**[NIT]** Naming\n\nRename this.",
        "src/b.ts",
        undefined,
      );

      expect(commentMap.get("f1")).toBe(111);
      expect(commentMap.get("f2")).toBe(222);

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        "AI Code Review: Changes Requested\n\n2 finding(s) posted as inline comments.",
        "REQUEST_CHANGES",
      );
      expect(logger.info).toHaveBeenCalledWith(
        {
          repo: "acme/widgets",
          prNumber: 42,
          findingsCount: 2,
          verdict: "changes_requested",
          mappedComments: 2,
        },
        "Posted review findings as PR review comments",
      );
    });

    it("submits an APPROVE review when the verdict is approved", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(1);

      await service.postReviewFindings("acme/widgets", 42, [], "approved");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        "AI Code Review: Approved\n\n0 finding(s) posted as inline comments.",
        "APPROVE",
      );
    });

    it("omits a finding from the comment map when createPRReviewComment returns a falsy id", async () => {
      githubClient.createPRReviewComment.mockResolvedValueOnce(0).mockResolvedValueOnce(99);

      const commentMap = await service.postReviewFindings(
        "acme/widgets",
        42,
        findings,
        "changes_requested",
      );

      expect(commentMap.has("f1")).toBe(false);
      expect(commentMap.get("f2")).toBe(99);
      expect(commentMap.size).toBe(1);
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("renders score, mixed check statuses, and a short files-changed list without a details collapse", async () => {
      const report = makeExecutionReport({
        executionVersion: 2,
        score: 0.875,
        scoreRationale: "Most checks pass",
        summary: "Did the work",
        filesChanged: ["src/a.ts", "src/b.ts"],
        checks: {
          lint: { status: "pass", details: "clean" },
          typecheck: { status: "fail", details: "2 errors" },
          tests: { status: "skip", details: "not run" },
        },
        notes: ["Be careful with X"],
      });

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
      const [repoArg, prArg, body] = githubClient.commentOnPR.mock.calls[0] as [
        string,
        number,
        string,
      ];
      expect(repoArg).toBe("acme/widgets");
      expect(prArg).toBe(42);

      const expected = [
        "## AI Execution Report (v2) -- Score: 88%",
        "",
        "*Most checks pass*",
        "",
        "Did the work",
        "",
        "### Checks",
        "- :white_check_mark: **Lint** -- clean\n- :x: **Typecheck** -- 2 errors\n- :heavy_minus_sign: **Tests** -- not run",
        "\n### Files changed (2)\n- `src/a.ts`\n- `src/b.ts`",
        "\n### Notes\n- Be careful with X",
      ].join("\n");

      expect(body).toBe(expected);
    });

    it("renders the exact body for a short file list and multiple notes with all checks passing", async () => {
      const report = makeExecutionReport({
        executionVersion: 1,
        score: 1,
        scoreRationale: "All good",
        summary: "Summary text",
        filesChanged: ["src/a.ts", "src/b.ts"],
        checks: {
          lint: { status: "pass", details: "clean" },
          typecheck: { status: "pass", details: "clean" },
          tests: { status: "pass", details: "clean" },
        },
        notes: ["Note one", "Note two"],
      });

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      const expected = [
        "## AI Execution Report (v1) -- Score: 100%",
        "",
        "*All good*",
        "",
        "Summary text",
        "",
        "### Checks",
        "- :white_check_mark: **Lint** -- clean\n- :white_check_mark: **Typecheck** -- clean\n- :white_check_mark: **Tests** -- clean",
        "\n### Files changed (2)\n- `src/a.ts`\n- `src/b.ts`",
        "\n### Notes\n- Note one\n- Note two",
      ].join("\n");

      expect(body).toBe(expected);
    });

    it("collapses the files-changed section into <details> when there are more than 8 files", async () => {
      const files = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);
      const report = makeExecutionReport({ filesChanged: files, notes: [] });

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("<summary><strong>Files changed (9)</strong></summary>");
      expect(body).toContain("- `src/file0.ts`");
      expect(body).toContain("</details>");
    });

    it("omits the files-changed and notes sections entirely when both are empty", async () => {
      const report = makeExecutionReport({ filesChanged: [], notes: [] });

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("Files changed");
      expect(body).not.toContain("### Notes");
    });

    it("logs the execution report update", async () => {
      const report = makeExecutionReport({ executionVersion: 3, score: 0.5, filesChanged: ["a.ts"] });
      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      expect(logger.info).toHaveBeenCalledWith(
        {
          repo: "acme/widgets",
          prNumber: 42,
          executionVersion: 3,
          score: 0.5,
          filesChanged: 1,
        },
        "Posted execution report update to PR",
      );
    });
  });

  describe("postRemediationResolutions", () => {
    const resolutions: ResolutionItem[] = [
      { findingId: "f1", status: "accepted", action: "Fixed null check", rationale: "Was a real bug" },
      {
        findingId: "f2",
        status: "rejected",
        action: "No change",
        rationale: "Style preference, not a bug",
      },
      {
        findingId: "f3",
        status: "partially_addressed",
        action: "Partial fix",
        rationale: "Needs follow-up",
      },
    ];

    it("replies to each mapped review comment with the resolution and posts a summary table", async () => {
      const commentMap: Record<string, number> = { f1: 111, f2: 222 };

      await service.postRemediationResolutions("acme/widgets", 42, resolutions, commentMap);

      expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(2);
      expect(githubClient.replyToReviewComment).toHaveBeenNthCalledWith(
        1,
        "acme/widgets",
        42,
        111,
        [
          ":white_check_mark: **accepted**",
          "",
          "**Action:** Fixed null check",
          "**Rationale:** Was a real bug",
        ].join("\n"),
      );
      expect(githubClient.replyToReviewComment).toHaveBeenNthCalledWith(
        2,
        "acme/widgets",
        42,
        222,
        [
          ":no_entry_sign: **rejected**",
          "",
          "**Action:** No change",
          "**Rationale:** Style preference, not a bug",
        ].join("\n"),
      );

      const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summaryBody).toBe(
        [
          "## AI Remediation Summary",
          "",
          "| Finding | Status | Action | Rationale |",
          "|---------|--------|--------|-----------|",
          "| :white_check_mark: **f1** | accepted | Fixed null check | Was a real bug |",
          "| :no_entry_sign: **f2** | rejected | No change | Style preference, not a bug |",
          "| :warning: **f3** | partially addressed | Partial fix | Needs follow-up |",
        ].join("\n"),
      );
    });

    it("skips replying for resolutions with no mapped GitHub comment id", async () => {
      await service.postRemediationResolutions("acme/widgets", 42, resolutions, {});

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    });

    it("falls back to a question-mark icon for an unrecognized status", async () => {
      const weirdResolutions = [
        {
          findingId: "f9",
          status: "unknown_status" as ResolutionItem["status"],
          action: "Did something",
          rationale: "Because",
        },
      ];

      await service.postRemediationResolutions("acme/widgets", 42, weirdResolutions, { f9: 5 });

      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        5,
        [":grey_question: **unknown status**", "", "**Action:** Did something", "**Rationale:** Because"].join(
          "\n",
        ),
      );
      const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summaryBody).toContain("| :grey_question: **f9** | unknown status | Did something | Because |");
    });

    it("logs resolution and reply counts", async () => {
      const commentMap: Record<string, number> = { f1: 111 };
      await service.postRemediationResolutions("acme/widgets", 42, resolutions, commentMap);

      expect(logger.info).toHaveBeenCalledWith(
        {
          repo: "acme/widgets",
          prNumber: 42,
          resolutionCount: 3,
          repliedTo: 1,
        },
        "Posted remediation resolutions to PR",
      );
    });
  });
});
