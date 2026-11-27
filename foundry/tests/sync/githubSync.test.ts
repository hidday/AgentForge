import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Finding } from "../../src/schemas/review.js";
import type { ResolutionItem } from "../../src/schemas/remediation.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { GitHubClient } from "../../src/github/githubClient.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeGithubClient(): Record<keyof GitHubClient, ReturnType<typeof vi.fn>> {
  return {
    verifyRepoAccess: vi.fn().mockResolvedValue(undefined),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
    createBranch: vi.fn().mockResolvedValue(undefined),
    createDraftPR: vi.fn().mockResolvedValue(1),
    commentOnPR: vi.fn().mockResolvedValue(undefined),
    getPRDiff: vi.fn().mockResolvedValue(""),
    markPRReady: vi.fn().mockResolvedValue(undefined),
    listPRComments: vi.fn().mockResolvedValue([]),
    createPRReviewComment: vi.fn().mockResolvedValue(555),
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
    repo: "test-repo",
    branchName: "ai/run-1",
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

describe("GitHubSyncService", () => {
  let githubClient: ReturnType<typeof makeGithubClient>;
  let logger: ReturnType<typeof makeLogger>;
  let service: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGithubClient();
    logger = makeLogger();
    service = new GitHubSyncService(githubClient as unknown as GitHubClient, logger as never);
  });

  describe("syncState", () => {
    it("does nothing when the run has no PR number", async () => {
      await service.syncState(makeRun({ prNumber: null }));
      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("does nothing when state is not ReadyForHumanReview, even with a PR", async () => {
      await service.syncState(makeRun({ state: RunState.Implementing }));
      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when state is ReadyForHumanReview", async () => {
      const run = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7, repo: "org/repo" });
      await service.syncState(run);

      expect(githubClient.markPRReady).toHaveBeenCalledWith("org/repo", 7);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
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

  describe("postReviewFindings", () => {
    const findings: Finding[] = [
      {
        id: "f1",
        severity: "blocker",
        type: "bug",
        file: "src/a.ts",
        lineHint: 10,
        title: "Null deref",
        details: "Possible null dereference",
      },
      {
        id: "f2",
        severity: "nit",
        type: "style",
        file: "src/b.ts",
        title: "Formatting",
        details: "Consider reformatting",
      },
    ];

    it("posts each finding as a review comment and maps ids that got a comment id", async () => {
      githubClient.createPRReviewComment
        .mockResolvedValueOnce(111)
        .mockResolvedValueOnce(0);

      const map = await service.postReviewFindings("org/repo", 5, findings, "changes_requested");

      expect(githubClient.createPRReviewComment).toHaveBeenCalledTimes(2);
      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        1,
        "org/repo",
        5,
        expect.stringContaining("[BLOCKER]"),
        "src/a.ts",
        10,
      );
      // falsy commentId (0) must not be added to the map
      expect(map.get("f1")).toBe(111);
      expect(map.has("f2")).toBe(false);

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "org/repo",
        5,
        expect.stringContaining("Changes Requested"),
        "REQUEST_CHANGES",
      );
    });

    it("submits an APPROVE event when verdict is 'approved'", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(222);
      await service.postReviewFindings("org/repo", 5, findings, "approved");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "org/repo",
        5,
        expect.stringContaining("Approved"),
        "APPROVE",
      );
    });

    it("handles an empty findings array", async () => {
      const map = await service.postReviewFindings("org/repo", 5, [], "approved");
      expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
      expect(map.size).toBe(0);
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "org/repo",
        5,
        expect.stringContaining("0 finding(s)"),
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
          lint: { status: "pass", details: "clean" },
          typecheck: { status: "fail", details: "2 errors" },
          tests: { status: "skip", details: "not run" },
        },
        notes: ["Note one"],
        prDraftCreated: true,
        score: 0.75,
        scoreRationale: "Mostly good",
        ...overrides,
      };
    }

    it("posts a comment with checks, files (collapsed under threshold), and notes", async () => {
      await service.postExecutionReportUpdate("org/repo", 9, makeReport());

      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
      const [repoArg, prArg, body] = githubClient.commentOnPR.mock.calls[0];
      expect(repoArg).toBe("org/repo");
      expect(prArg).toBe(9);
      expect(body).toContain("Score: 75%");
      expect(body).toContain(":white_check_mark: **Lint**");
      expect(body).toContain(":x: **Typecheck**");
      expect(body).toContain(":heavy_minus_sign: **Tests**");
      expect(body).toContain("### Files changed (2)");
      expect(body).toContain("`src/a.ts`");
      expect(body).not.toContain("<details>");
      expect(body).toContain("### Notes");
      expect(body).toContain("- Note one");

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ repo: "org/repo", prNumber: 9, executionVersion: 2 }),
        "Posted execution report update to PR",
      );
    });

    it("collapses files changed into a <details> block above the threshold", async () => {
      const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
      await service.postExecutionReportUpdate("org/repo", 9, makeReport({ filesChanged: manyFiles }));

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain(`Files changed (${manyFiles.length})`);
      expect(body).toContain("</details>");
    });

    it("omits the files section when there are no files changed", async () => {
      await service.postExecutionReportUpdate("org/repo", 9, makeReport({ filesChanged: [] }));
      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("Files changed");
    });

    it("omits the notes section when there are no notes", async () => {
      await service.postExecutionReportUpdate("org/repo", 9, makeReport({ notes: [] }));
      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("### Notes");
    });
  });

  describe("postRemediationResolutions", () => {
    const resolutions: ResolutionItem[] = [
      {
        findingId: "f1",
        status: "accepted",
        action: "Fixed the null check",
        rationale: "Valid finding",
      },
      {
        findingId: "f2",
        status: "rejected",
        action: "No change",
        rationale: "Not applicable",
      },
      {
        findingId: "f3",
        status: "partially_addressed",
        action: "Partially fixed",
        rationale: "Some concerns remain",
      },
    ];

    it("replies to review comments that have a mapped github comment id, posts a summary", async () => {
      const commentMap: Record<string, number> = { f1: 111, f3: 333 };

      await service.postRemediationResolutions("org/repo", 9, resolutions, commentMap);

      // f1 and f3 have mapped comment ids; f2 does not, so no reply for it
      expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(2);
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "org/repo",
        9,
        111,
        expect.stringContaining("accepted"),
      );
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "org/repo",
        9,
        333,
        expect.stringContaining("partially addressed"),
      );

      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
      const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain("## AI Remediation Summary");
      expect(summary).toContain("f1");
      expect(summary).toContain("f2");
      expect(summary).toContain("f3");

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ repo: "org/repo", prNumber: 9, resolutionCount: 3, repliedTo: 2 }),
        "Posted remediation resolutions to PR",
      );
    });

    it("uses the grey-question fallback icon for an unknown status", async () => {
      const weirdResolutions = [
        {
          findingId: "f9",
          status: "mystery" as unknown as ResolutionItem["status"],
          action: "Did something",
          rationale: "Unclear",
        },
      ];
      await service.postRemediationResolutions("org/repo", 9, weirdResolutions, { f9: 999 });

      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "org/repo",
        9,
        999,
        expect.stringContaining(":grey_question:"),
      );
      const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain(":grey_question:");
    });

    it("handles an empty resolutions array without replying or erroring", async () => {
      await service.postRemediationResolutions("org/repo", 9, [], {});
      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    });
  });
});
