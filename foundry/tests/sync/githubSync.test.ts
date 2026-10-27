import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Finding } from "../../src/schemas/review.js";
import type { ResolutionItem } from "../../src/schemas/remediation.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
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
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: "ai/issue-1",
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
    id: "finding-1",
    severity: "important",
    type: "bug",
    file: "src/a.ts",
    title: "Possible bug",
    details: "Explanation",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
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

describe("GitHubSyncService", () => {
  let githubClient: ReturnType<typeof makeGitHubClient>;
  let service: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGitHubClient();
    service = new GitHubSyncService(githubClient as never, makeLogger() as never);
  });

  describe("syncState", () => {
    it("does nothing when the run has no PR number", async () => {
      await service.syncState(makeRun({ prNumber: null, state: RunState.ReadyForHumanReview }));

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when state is ReadyForHumanReview", async () => {
      await service.syncState(makeRun({ prNumber: 42, state: RunState.ReadyForHumanReview }));

      expect(githubClient.markPRReady).toHaveBeenCalledWith("org/repo", 42);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "org/repo",
        42,
        "All AI checks passed. Ready for human review.",
      );
    });

    it("does nothing for a PR-having run in a different state", async () => {
      await service.syncState(makeRun({ prNumber: 42, state: RunState.Implementing }));

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });
  });

  describe("postReviewFindings", () => {
    it("posts each finding as a review comment and maps only non-zero comment ids", async () => {
      githubClient.createPRReviewComment
        .mockResolvedValueOnce(1001)
        .mockResolvedValueOnce(0);
      const findings = [
        makeFinding({ id: "f1", file: "src/a.ts", lineHint: 5 }),
        makeFinding({ id: "f2", file: "src/b.ts" }),
      ];

      const commentMap = await service.postReviewFindings("org/repo", 42, findings, "changes_requested");

      expect(commentMap.get("f1")).toBe(1001);
      expect(commentMap.has("f2")).toBe(false);
      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        1,
        "org/repo",
        42,
        "**[IMPORTANT]** Possible bug\n\nExplanation",
        "src/a.ts",
        5,
      );
      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        2,
        "org/repo",
        42,
        "**[IMPORTANT]** Possible bug\n\nExplanation",
        "src/b.ts",
        undefined,
      );
    });

    it("submits an APPROVE review when verdict is approved", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(1001);

      await service.postReviewFindings("org/repo", 42, [makeFinding()], "approved");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "org/repo",
        42,
        expect.stringContaining("Approved"),
        "APPROVE",
      );
    });

    it("submits a REQUEST_CHANGES review when verdict is not approved", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(1001);

      await service.postReviewFindings("org/repo", 42, [makeFinding()], "changes_requested");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "org/repo",
        42,
        expect.stringContaining("Changes Requested"),
        "REQUEST_CHANGES",
      );
    });

    it("submits a review with an empty comment map when there are no findings", async () => {
      const commentMap = await service.postReviewFindings("org/repo", 42, [], "approved");

      expect(commentMap.size).toBe(0);
      expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "org/repo",
        42,
        expect.stringContaining("0 finding(s)"),
        "APPROVE",
      );
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("posts a comment with score, check icons, and no files/notes sections when both are empty", async () => {
      const report = makeExecutionReport({ filesChanged: [], notes: [], score: 0.75 });

      await service.postExecutionReportUpdate("org/repo", 42, report);

      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("Score: 75%");
      expect(body).toContain(":white_check_mark: **Lint**");
      expect(body).not.toContain("Files changed");
      expect(body).not.toContain("### Notes");
    });

    it("shows a failing check with the :x: icon and an unknown status with :heavy_minus_sign:", async () => {
      const report = makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "2 errors" },
          typecheck: { status: "pass", details: "clean" },
          tests: { status: "skip", details: "not run" },
        },
      });

      await service.postExecutionReportUpdate("org/repo", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain(":x: **Lint**");
      expect(body).toContain(":heavy_minus_sign: **Tests**");
    });

    it("lists files inline when at or below the collapse threshold", async () => {
      const report = makeExecutionReport({ filesChanged: ["a.ts", "b.ts"] });

      await service.postExecutionReportUpdate("org/repo", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("### Files changed (2)");
      expect(body).not.toContain("<details>");
    });

    it("collapses files into a <details> block above the collapse threshold", async () => {
      const files = Array.from({ length: 9 }, (_, i) => `file-${String(i)}.ts`);
      const report = makeExecutionReport({ filesChanged: files });

      await service.postExecutionReportUpdate("org/repo", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
    });

    it("includes a notes section when notes are present", async () => {
      const report = makeExecutionReport({ notes: ["Watch out for X", "Y was skipped"] });

      await service.postExecutionReportUpdate("org/repo", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("### Notes");
      expect(body).toContain("- Watch out for X");
      expect(body).toContain("- Y was skipped");
    });
  });

  describe("postRemediationResolutions", () => {
    it("replies to the mapped GitHub comment for each resolution and posts a summary table", async () => {
      const resolutions: ResolutionItem[] = [
        {
          findingId: "f1",
          status: "accepted",
          action: "Fixed the bug",
          rationale: "It was a real issue",
        },
        {
          findingId: "f2",
          status: "rejected",
          action: "No change",
          rationale: "Not reproducible",
        },
      ];
      const commentMap = { f1: 1001 };

      await service.postRemediationResolutions("org/repo", 42, resolutions, commentMap);

      expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(1);
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "org/repo",
        42,
        1001,
        expect.stringContaining("accepted"),
      );
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "org/repo",
        42,
        expect.stringContaining("AI Remediation Summary"),
      );
      const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain("f1");
      expect(summary).toContain("f2");
    });

    it("skips replying when a resolution has no mapped GitHub comment id", async () => {
      const resolutions: ResolutionItem[] = [
        { findingId: "f-unmapped", status: "partially_addressed", action: "Partial fix", rationale: "r" },
      ];

      await service.postRemediationResolutions("org/repo", 42, resolutions, {});

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    });

    it("falls back to a grey-question icon for an unrecognized status", async () => {
      const resolutions = [
        {
          findingId: "f1",
          status: "weird_status" as unknown as ResolutionItem["status"],
          action: "Did something",
          rationale: "Because",
        },
      ];

      await service.postRemediationResolutions("org/repo", 42, resolutions, { f1: 5 });

      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "org/repo",
        42,
        5,
        expect.stringContaining(":grey_question:"),
      );
    });
  });
});
