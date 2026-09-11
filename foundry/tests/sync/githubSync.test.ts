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
    repo: "acme/repo",
    branchName: "ai/issue-1",
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
    severity: "important",
    type: "bug",
    file: "src/a.ts",
    title: "Possible null deref",
    details: "This value could be null.",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
    filesChanged: ["src/a.ts", "src/b.ts"],
    checks: {
      lint: { status: "pass", details: "no issues" },
      typecheck: { status: "pass", details: "no issues" },
      tests: { status: "pass", details: "12 passed" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "All checks passed.",
    ...overrides,
  };
}

describe("GitHubSyncService", () => {
  let githubClient: ReturnType<typeof makeGitHubClient>;
  let logger: ReturnType<typeof makeLogger>;
  let service: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGitHubClient();
    logger = makeLogger();
    service = new GitHubSyncService(githubClient as never, logger as never);
  });

  describe("syncState", () => {
    it("does nothing when the run has no PR number", async () => {
      const run = makeRun({ prNumber: null });

      await service.syncState(run);

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when state is ReadyForHumanReview", async () => {
      const run = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42 });

      await service.syncState(run);

      expect(githubClient.markPRReady).toHaveBeenCalledWith("acme/repo", 42);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "acme/repo",
        42,
        "All AI checks passed. Ready for human review.",
      );
      expect(logger.debug).toHaveBeenCalled();
    });

    it("does nothing for states other than ReadyForHumanReview", async () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 42 });

      await service.syncState(run);

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("propagates errors from the GitHub client", async () => {
      const run = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42 });
      githubClient.markPRReady.mockRejectedValue(new Error("GitHub unavailable"));

      await expect(service.syncState(run)).rejects.toThrow("GitHub unavailable");
    });
  });

  describe("postReviewFindings", () => {
    it("posts each finding as an inline review comment and submits an APPROVE review", async () => {
      const findings = [
        makeFinding({ id: "f1", severity: "important", lineHint: 10 }),
        makeFinding({ id: "f2", severity: "nit", file: "src/b.ts", lineHint: 20 }),
      ];
      githubClient.createPRReviewComment
        .mockResolvedValueOnce(1001)
        .mockResolvedValueOnce(1002);

      const commentMap = await service.postReviewFindings("acme/repo", 42, findings, "approved");

      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        1,
        "acme/repo",
        42,
        expect.stringContaining("[IMPORTANT]"),
        "src/a.ts",
        10,
      );
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/repo",
        42,
        expect.stringContaining("Approved"),
        "APPROVE",
      );
      expect(commentMap).toEqual(
        new Map([
          ["f1", 1001],
          ["f2", 1002],
        ]),
      );
    });

    it("submits REQUEST_CHANGES when the verdict is not approved", async () => {
      const findings = [makeFinding()];
      githubClient.createPRReviewComment.mockResolvedValue(2001);

      await service.postReviewFindings("acme/repo", 42, findings, "changes_requested");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/repo",
        42,
        expect.stringContaining("Changes Requested"),
        "REQUEST_CHANGES",
      );
    });

    it("omits findings from the map when the client returns a falsy comment id", async () => {
      const findings = [makeFinding({ id: "f1" })];
      githubClient.createPRReviewComment.mockResolvedValue(0);

      const commentMap = await service.postReviewFindings("acme/repo", 42, findings, "approved");

      expect(commentMap.size).toBe(0);
    });

    it("handles an empty findings list", async () => {
      const commentMap = await service.postReviewFindings("acme/repo", 42, [], "approved");

      expect(commentMap.size).toBe(0);
      expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/repo",
        42,
        expect.stringContaining("0 finding(s)"),
        "APPROVE",
      );
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("posts a formatted comment with score, checks, and a short files list", async () => {
      const report = makeExecutionReport();

      await service.postExecutionReportUpdate("acme/repo", 42, report);

      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
      const [repoArg, prArg, body] = githubClient.commentOnPR.mock.calls[0] as [
        string,
        number,
        string,
      ];
      expect(repoArg).toBe("acme/repo");
      expect(prArg).toBe(42);
      expect(body).toContain("Score: 90%");
      expect(body).toContain(":white_check_mark: **Lint**");
      expect(body).toContain("Files changed (2)");
      expect(body).not.toContain("<details>");
      expect(logger.info).toHaveBeenCalled();
    });

    it("collapses the files list behind <details> above the threshold", async () => {
      const report = makeExecutionReport({
        filesChanged: Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`),
      });

      await service.postExecutionReportUpdate("acme/repo", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
    });

    it("omits the files section entirely when no files changed", async () => {
      const report = makeExecutionReport({ filesChanged: [] });

      await service.postExecutionReportUpdate("acme/repo", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("Files changed");
    });

    it("includes a notes section when notes are present", async () => {
      const report = makeExecutionReport({ notes: ["Watch out for flaky test X"] });

      await service.postExecutionReportUpdate("acme/repo", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("### Notes");
      expect(body).toContain("Watch out for flaky test X");
    });

    it("omits the notes section when there are no notes", async () => {
      const report = makeExecutionReport({ notes: [] });

      await service.postExecutionReportUpdate("acme/repo", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("### Notes");
    });

    it("renders failing and skipped check icons correctly", async () => {
      const report = makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "2 errors" },
          typecheck: { status: "skip", details: "not run" },
          tests: { status: "pass", details: "all good" },
        },
      });

      await service.postExecutionReportUpdate("acme/repo", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain(":x: **Lint**");
      expect(body).toContain(":heavy_minus_sign: **Typecheck**");
      expect(body).toContain(":white_check_mark: **Tests**");
    });
  });

  describe("postRemediationResolutions", () => {
    function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
      return {
        findingId: "f1",
        status: "accepted",
        action: "Fixed the null check",
        rationale: "Added a guard clause",
        ...overrides,
      };
    }

    it("replies to mapped findings and posts a summary table", async () => {
      const resolutions = [
        makeResolution({ findingId: "f1", status: "accepted" }),
        makeResolution({ findingId: "f2", status: "rejected" }),
      ];
      const commentMap = { f1: 1001, f2: 1002 };

      await service.postRemediationResolutions("acme/repo", 42, resolutions, commentMap);

      expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(2);
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "acme/repo",
        42,
        1001,
        expect.stringContaining("accepted"),
      );
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "acme/repo",
        42,
        expect.stringContaining("AI Remediation Summary"),
      );
      expect(logger.info).toHaveBeenCalled();
    });

    it("skips replying for resolutions with no mapped GitHub comment id", async () => {
      const resolutions = [makeResolution({ findingId: "f-unmapped" })];

      await service.postRemediationResolutions("acme/repo", 42, resolutions, {});

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).toHaveBeenCalled();
    });

    it("falls back to a question-mark icon for an unrecognized status", async () => {
      const resolutions = [
        makeResolution({
          findingId: "f1",
          status: "mystery_status" as ResolutionItem["status"],
        }),
      ];

      await service.postRemediationResolutions("acme/repo", 42, resolutions, { f1: 1001 });

      const replyBody = githubClient.replyToReviewComment.mock.calls[0][3] as string;
      expect(replyBody).toContain(":grey_question:");
    });

    it("handles partially_addressed status with the warning icon", async () => {
      const resolutions = [makeResolution({ findingId: "f1", status: "partially_addressed" })];

      await service.postRemediationResolutions("acme/repo", 42, resolutions, { f1: 1001 });

      const replyBody = githubClient.replyToReviewComment.mock.calls[0][3] as string;
      expect(replyBody).toContain(":warning:");
    });

    it("handles an empty resolutions list", async () => {
      await service.postRemediationResolutions("acme/repo", 42, [], {});

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "acme/repo",
        42,
        expect.stringContaining("AI Remediation Summary"),
      );
    });
  });
});
