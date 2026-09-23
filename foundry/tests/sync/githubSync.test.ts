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

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "owner/repo",
    branchName: "ai/issue-1",
    prNumber: 42,
    state: RunState.ReadyForHumanReview,
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

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "important",
    type: "bug",
    file: "src/a.ts",
    title: "Some finding",
    details: "Some details",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Did the thing",
    filesChanged: [],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "pass", details: "clean" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks solid",
    ...overrides,
  };
}

function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
  return {
    findingId: "f1",
    status: "accepted",
    action: "Fixed it",
    rationale: "Was a real bug",
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
      await service.syncState(makeRun({ prNumber: null }));

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("does nothing when the run has a PR but is not ReadyForHumanReview", async () => {
      await service.syncState(makeRun({ state: RunState.Implementing }));

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when ReadyForHumanReview", async () => {
      const run = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42, repo: "owner/repo" });

      await service.syncState(run);

      expect(githubClient.markPRReady).toHaveBeenCalledWith("owner/repo", 42);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "owner/repo",
        42,
        "All AI checks passed. Ready for human review.",
      );
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe("postReviewFindings", () => {
    it("posts inline comments for each finding and submits an APPROVE review", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(1001);

      const commentMap = await service.postReviewFindings(
        "owner/repo",
        42,
        [makeFinding({ id: "f1", lineHint: 12 })],
        "approved",
      );

      expect(githubClient.createPRReviewComment).toHaveBeenCalledWith(
        "owner/repo",
        42,
        "**[IMPORTANT]** Some finding\n\nSome details",
        "src/a.ts",
        12,
      );
      expect(commentMap.get("f1")).toBe(1001);
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.stringContaining("Approved") as unknown as string,
        "APPROVE",
      );
    });

    it("submits REQUEST_CHANGES for a non-approved verdict and skips comment ids of 0", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(0);

      const commentMap = await service.postReviewFindings(
        "owner/repo",
        42,
        [makeFinding({ id: "f1" })],
        "changes_requested",
      );

      expect(commentMap.has("f1")).toBe(false);
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.stringContaining("Changes Requested") as unknown as string,
        "REQUEST_CHANGES",
      );
    });

    it("handles an empty findings list", async () => {
      const commentMap = await service.postReviewFindings("owner/repo", 42, [], "approved");

      expect(commentMap.size).toBe(0);
      expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
      expect(githubClient.submitPRReview).toHaveBeenCalled();
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("posts a report with no files/notes sections when both are empty", async () => {
      await service.postExecutionReportUpdate("owner/repo", 42, makeExecutionReport());

      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("Score: 90%");
      expect(body).not.toContain("Files changed");
      expect(body).not.toContain("### Notes");
    });

    it("renders a flat file list when filesChanged is at or below the collapse threshold", async () => {
      const report = makeExecutionReport({
        filesChanged: ["a.ts", "b.ts"],
        notes: ["Did something notable"],
        checks: {
          lint: { status: "fail", details: "2 errors" },
          typecheck: { status: "skip", details: "not run" },
          tests: { status: "pass", details: "all green" },
        },
      });

      await service.postExecutionReportUpdate("owner/repo", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("Files changed (2)");
      expect(body).toContain("`a.ts`");
      expect(body).not.toContain("<details>");
      expect(body).toContain("### Notes");
      expect(body).toContain("- Did something notable");
      expect(body).toContain(":x:");
      expect(body).toContain(":heavy_minus_sign:");
      expect(body).toContain(":white_check_mark:");
    });

    it("collapses the file list into a <details> block above the threshold", async () => {
      const report = makeExecutionReport({
        filesChanged: Array.from({ length: 9 }, (_, i) => `file${String(i)}.ts`),
      });

      await service.postExecutionReportUpdate("owner/repo", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
    });
  });

  describe("postRemediationResolutions", () => {
    it("replies to mapped comments and posts a summary table", async () => {
      await service.postRemediationResolutions(
        "owner/repo",
        42,
        [
          makeResolution({ findingId: "f1", status: "accepted" }),
          makeResolution({ findingId: "f2", status: "rejected" }),
          makeResolution({ findingId: "f3", status: "partially_addressed" }),
        ],
        { f1: 1001, f2: 1002 },
      );

      expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(2);
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "owner/repo",
        42,
        1001,
        expect.stringContaining("accepted") as unknown as string,
      );
      // f3 has no mapped GitHub comment id, so no reply for it.
      expect(githubClient.replyToReviewComment).not.toHaveBeenCalledWith(
        "owner/repo",
        42,
        undefined,
        expect.anything(),
      );

      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
      const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain("AI Remediation Summary");
      expect(summary).toContain("f1");
      expect(summary).toContain("f2");
      expect(summary).toContain("f3");
    });

    it("handles an empty resolutions list", async () => {
      await service.postRemediationResolutions("owner/repo", 42, [], {});

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    });

    it("falls back to a question-mark icon for an unrecognized status", async () => {
      await service.postRemediationResolutions(
        "owner/repo",
        42,
        [makeResolution({ findingId: "f1", status: "weird" as ResolutionItem["status"] })],
        { f1: 1001 },
      );

      const replyBody = githubClient.replyToReviewComment.mock.calls[0][3] as string;
      expect(replyBody).toContain(":grey_question:");
    });
  });
});
