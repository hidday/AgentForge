import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Finding } from "../../src/schemas/review.js";
import type { ResolutionItem } from "../../src/schemas/remediation.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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
    createPRReviewComment: vi.fn(),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
    submitPRReview: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "lin-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: "ai/eng-1",
    prNumber: 5,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/wd",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("GitHubSyncService", () => {
  describe("syncState", () => {
    it("does nothing when the run has no PR yet", async () => {
      const github = makeGitHubClient();
      const svc = new GitHubSyncService(github as never, makeLogger() as never);

      await svc.syncState(makeRun({ prNumber: null, state: RunState.ReadyForHumanReview }));

      expect(github.markPRReady).not.toHaveBeenCalled();
      expect(github.commentOnPR).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when the run reaches ReadyForHumanReview", async () => {
      const github = makeGitHubClient();
      const logger = makeLogger();
      const svc = new GitHubSyncService(github as never, logger as never);

      await svc.syncState(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 5 }));

      expect(github.markPRReady).toHaveBeenCalledWith("acme/widgets", 5);
      expect(github.commentOnPR).toHaveBeenCalledWith(
        "acme/widgets",
        5,
        "All AI checks passed. Ready for human review.",
      );
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 5 },
        "Marked PR ready for review",
      );
    });

    it("does nothing for other states even with a PR present", async () => {
      const github = makeGitHubClient();
      const svc = new GitHubSyncService(github as never, makeLogger() as never);

      await svc.syncState(makeRun({ state: RunState.AIReview, prNumber: 5 }));

      expect(github.markPRReady).not.toHaveBeenCalled();
      expect(github.commentOnPR).not.toHaveBeenCalled();
    });
  });

  describe("postReviewFindings", () => {
    function makeFinding(overrides: Partial<Finding> = {}): Finding {
      return {
        id: "f1",
        severity: "important",
        type: "bug",
        file: "src/x.ts",
        lineHint: 10,
        title: "Off by one",
        details: "Loop bound is wrong",
        ...overrides,
      };
    }

    it("posts an inline comment per finding and maps finding ids to comment ids", async () => {
      const github = makeGitHubClient();
      github.createPRReviewComment.mockResolvedValueOnce(101).mockResolvedValueOnce(102);
      const svc = new GitHubSyncService(github as never, makeLogger() as never);

      const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2", severity: "nit" })];
      const commentMap = await svc.postReviewFindings("acme/widgets", 5, findings, "changes_requested");

      expect(github.createPRReviewComment).toHaveBeenNthCalledWith(
        1,
        "acme/widgets",
        5,
        "**[IMPORTANT]** Off by one\n\nLoop bound is wrong",
        "src/x.ts",
        10,
      );
      expect(commentMap).toEqual(
        new Map([
          ["f1", 101],
          ["f2", 102],
        ]),
      );
      expect(github.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        5,
        "AI Code Review: Changes Requested\n\n2 finding(s) posted as inline comments.",
        "REQUEST_CHANGES",
      );
    });

    it("uses APPROVE event and 'Approved' summary text for an approved verdict", async () => {
      const github = makeGitHubClient();
      github.createPRReviewComment.mockResolvedValue(1);
      const svc = new GitHubSyncService(github as never, makeLogger() as never);

      await svc.postReviewFindings("acme/widgets", 5, [makeFinding()], "approved");

      expect(github.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        5,
        expect.stringContaining("AI Code Review: Approved"),
        "APPROVE",
      );
    });

    it("skips a finding in the map when createPRReviewComment returns 0 (skipped comment)", async () => {
      const github = makeGitHubClient();
      github.createPRReviewComment.mockResolvedValue(0);
      const svc = new GitHubSyncService(github as never, makeLogger() as never);

      const commentMap = await svc.postReviewFindings(
        "acme/widgets",
        5,
        [makeFinding()],
        "approved",
      );

      expect(commentMap.size).toBe(0);
    });

    it("returns an empty map and posts a zero-count summary for no findings", async () => {
      const github = makeGitHubClient();
      const svc = new GitHubSyncService(github as never, makeLogger() as never);

      const commentMap = await svc.postReviewFindings("acme/widgets", 5, [], "approved");

      expect(commentMap.size).toBe(0);
      expect(github.createPRReviewComment).not.toHaveBeenCalled();
      expect(github.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        5,
        expect.stringContaining("0 finding(s) posted as inline comments."),
        "APPROVE",
      );
    });
  });

  describe("postExecutionReportUpdate", () => {
    function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
      return {
        executionVersion: 2,
        summary: "Implemented the feature",
        filesChanged: ["src/a.ts", "src/b.ts"],
        checks: {
          lint: { status: "pass", details: "0 problems" },
          typecheck: { status: "fail", details: "2 errors" },
          tests: { status: "skip", details: "not run" },
        },
        notes: ["Note one"],
        prDraftCreated: true,
        score: 0.75,
        scoreRationale: "Mostly complete",
        ...overrides,
      };
    }

    it("renders checks, a short file list, and notes, then comments on the PR", async () => {
      const github = makeGitHubClient();
      const logger = makeLogger();
      const svc = new GitHubSyncService(github as never, logger as never);

      await svc.postExecutionReportUpdate("acme/widgets", 5, makeReport());

      expect(github.commentOnPR).toHaveBeenCalledTimes(1);
      const [repo, prNumber, body] = github.commentOnPR.mock.calls[0] as [string, number, string];
      expect(repo).toBe("acme/widgets");
      expect(prNumber).toBe(5);
      expect(body).toContain("## AI Execution Report (v2) -- Score: 75%");
      expect(body).toContain(":white_check_mark: **Lint** -- 0 problems");
      expect(body).toContain(":x: **Typecheck** -- 2 errors");
      expect(body).toContain(":heavy_minus_sign: **Tests** -- not run");
      expect(body).toContain("### Files changed (2)");
      expect(body).toContain("- `src/a.ts`");
      expect(body).not.toContain("<details>");
      expect(body).toContain("### Notes");
      expect(body).toContain("- Note one");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ repo: "acme/widgets", prNumber: 5, executionVersion: 2 }),
        "Posted execution report update to PR",
      );
    });

    it("collapses the file list into a <details> block above the threshold of 8 files", async () => {
      const github = makeGitHubClient();
      const svc = new GitHubSyncService(github as never, makeLogger() as never);
      const filesChanged = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);

      await svc.postExecutionReportUpdate("acme/widgets", 5, makeReport({ filesChanged }));

      const body = github.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
      expect(body).toContain("- `src/file8.ts`");
    });

    it("omits the files section when there are no files changed", async () => {
      const github = makeGitHubClient();
      const svc = new GitHubSyncService(github as never, makeLogger() as never);

      await svc.postExecutionReportUpdate("acme/widgets", 5, makeReport({ filesChanged: [] }));

      const body = github.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("Files changed");
    });

    it("omits the notes section when there are no notes", async () => {
      const github = makeGitHubClient();
      const svc = new GitHubSyncService(github as never, makeLogger() as never);

      await svc.postExecutionReportUpdate("acme/widgets", 5, makeReport({ notes: [] }));

      const body = github.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("### Notes");
    });
  });

  describe("postRemediationResolutions", () => {
    function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
      return {
        findingId: "f1",
        status: "accepted",
        action: "Fixed the bug",
        rationale: "Was a real bug",
        ...overrides,
      };
    }

    it("replies to mapped findings and posts a summary table", async () => {
      const github = makeGitHubClient();
      const logger = makeLogger();
      const svc = new GitHubSyncService(github as never, logger as never);

      const resolutions = [
        makeResolution({ findingId: "f1", status: "accepted" }),
        makeResolution({ findingId: "f2", status: "rejected", action: "No change", rationale: "Not a bug" }),
        makeResolution({
          findingId: "f3",
          status: "partially_addressed",
          action: "Partial fix",
          rationale: "Time constrained",
        }),
      ];
      const commentMap = { f1: 101, f2: 102 }; // f3 has no mapped GitHub comment

      await svc.postRemediationResolutions("acme/widgets", 5, resolutions, commentMap);

      expect(github.replyToReviewComment).toHaveBeenCalledTimes(2);
      expect(github.replyToReviewComment).toHaveBeenNthCalledWith(
        1,
        "acme/widgets",
        5,
        101,
        expect.stringContaining(":white_check_mark: **accepted**"),
      );
      expect(github.replyToReviewComment).toHaveBeenNthCalledWith(
        2,
        "acme/widgets",
        5,
        102,
        expect.stringContaining(":no_entry_sign: **rejected**"),
      );

      expect(github.commentOnPR).toHaveBeenCalledTimes(1);
      const summary = github.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain("## AI Remediation Summary");
      expect(summary).toContain(":warning: **f3** | partially addressed | Partial fix | Time constrained |");
      expect(logger.info).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 5, resolutionCount: 3, repliedTo: 2 },
        "Posted remediation resolutions to PR",
      );
    });

    it("falls back to a question-mark icon for an unrecognized status", async () => {
      const github = makeGitHubClient();
      const svc = new GitHubSyncService(github as never, makeLogger() as never);

      await svc.postRemediationResolutions(
        "acme/widgets",
        5,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [makeResolution({ findingId: "f1", status: "weird-status" as any })],
        { f1: 101 },
      );

      expect(github.replyToReviewComment).toHaveBeenCalledWith(
        "acme/widgets",
        5,
        101,
        expect.stringContaining(":grey_question: **weird-status**"),
      );
    });

    it("skips replies for resolutions with no mapped GitHub comment id", async () => {
      const github = makeGitHubClient();
      const svc = new GitHubSyncService(github as never, makeLogger() as never);

      await svc.postRemediationResolutions("acme/widgets", 5, [makeResolution({ findingId: "unmapped" })], {});

      expect(github.replyToReviewComment).not.toHaveBeenCalled();
      expect(github.commentOnPR).toHaveBeenCalledTimes(1);
    });
  });
});
