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
    branchName: "ai/lin-1",
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
    file: "src/foo.ts",
    title: "Bug title",
    details: "Bug details",
    ...overrides,
  };
}

function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Did the work",
    filesChanged: [],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks good",
    ...overrides,
  };
}

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
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
    submitPRReview: vi.fn().mockResolvedValue(undefined),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
  };
}

describe("GitHubSyncService", () => {
  let githubClient: ReturnType<typeof makeGitHubClient>;
  let logger: ReturnType<typeof makeLogger>;
  let svc: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGitHubClient();
    logger = makeLogger();
    svc = new GitHubSyncService(githubClient as never, logger as never);
  });

  describe("syncState", () => {
    it("does nothing when the run has no PR number", async () => {
      await svc.syncState(makeRun({ prNumber: null }));
      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("does nothing when the run has a PR but isn't ReadyForHumanReview", async () => {
      await svc.syncState(makeRun({ state: RunState.Implementing }));
      expect(githubClient.markPRReady).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when ReadyForHumanReview", async () => {
      await svc.syncState(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7 }));
      expect(githubClient.markPRReady).toHaveBeenCalledWith("test-repo", 7);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "test-repo",
        7,
        "All AI checks passed. Ready for human review.",
      );
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe("postReviewFindings", () => {
    it("maps findings to comment ids when the client returns one", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(123);
      const map = await svc.postReviewFindings(
        "test-repo",
        5,
        [makeFinding({ id: "f1" })],
        "approved",
      );
      expect(map.get("f1")).toBe(123);
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "test-repo",
        5,
        expect.stringContaining("Approved"),
        "APPROVE",
      );
    });

    it("omits findings from the map when the client returns no comment id", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(undefined);
      const map = await svc.postReviewFindings("test-repo", 5, [makeFinding()], "changes_requested");
      expect(map.size).toBe(0);
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "test-repo",
        5,
        expect.stringContaining("Changes Requested"),
        "REQUEST_CHANGES",
      );
    });

    it("builds the review comment body from severity, title, and details", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(1);
      await svc.postReviewFindings(
        "test-repo",
        5,
        [makeFinding({ severity: "blocker", title: "Bad bug", details: "Stack trace here" })],
        "approved",
      );
      expect(githubClient.createPRReviewComment).toHaveBeenCalledWith(
        "test-repo",
        5,
        expect.stringContaining("[BLOCKER]"),
        "src/foo.ts",
        undefined,
      );
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("renders pass/fail/skip check icons and no files/notes sections when empty", async () => {
      await svc.postExecutionReportUpdate("test-repo", 5, makeReport());
      const body = githubClient.commentOnPR.mock.calls[0]![2] as string;
      expect(body).toContain(":white_check_mark:");
      expect(body).not.toContain("Files changed");
      expect(body).not.toContain("### Notes");
      expect(logger.info).toHaveBeenCalled();
    });

    it("renders a failing check with the X icon and a skipped check with the dash icon", async () => {
      await svc.postExecutionReportUpdate(
        "test-repo",
        5,
        makeReport({
          checks: {
            lint: { status: "fail", details: "errors" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "skip", details: "skipped" },
          },
        }),
      );
      const body = githubClient.commentOnPR.mock.calls[0]![2] as string;
      expect(body).toContain(":x:");
      expect(body).toContain(":heavy_minus_sign:");
    });

    it("lists files inline when at or below the collapse threshold", async () => {
      const files = Array.from({ length: 8 }, (_, i) => `src/file${String(i)}.ts`);
      await svc.postExecutionReportUpdate("test-repo", 5, makeReport({ filesChanged: files }));
      const body = githubClient.commentOnPR.mock.calls[0]![2] as string;
      expect(body).toContain("### Files changed (8)");
      expect(body).not.toContain("<details>");
    });

    it("collapses files into a <details> block above the threshold", async () => {
      const files = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);
      await svc.postExecutionReportUpdate("test-repo", 5, makeReport({ filesChanged: files }));
      const body = githubClient.commentOnPR.mock.calls[0]![2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
    });

    it("renders a notes section when notes are present", async () => {
      await svc.postExecutionReportUpdate(
        "test-repo",
        5,
        makeReport({ notes: ["Watch out for X", "Also Y"] }),
      );
      const body = githubClient.commentOnPR.mock.calls[0]![2] as string;
      expect(body).toContain("### Notes");
      expect(body).toContain("Watch out for X");
    });
  });

  describe("postRemediationResolutions", () => {
    function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
      return {
        findingId: "f1",
        status: "accepted",
        action: "Fixed it",
        rationale: "Because",
        ...overrides,
      };
    }

    it("replies to the mapped GitHub comment when one exists for the finding", async () => {
      await svc.postRemediationResolutions(
        "test-repo",
        5,
        [makeResolution({ findingId: "f1", status: "accepted" })],
        { f1: 999 },
      );
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "test-repo",
        5,
        999,
        expect.stringContaining(":white_check_mark:"),
      );
      expect(githubClient.commentOnPR).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
    });

    it("does not reply when no comment is mapped for the finding", async () => {
      await svc.postRemediationResolutions(
        "test-repo",
        5,
        [makeResolution({ findingId: "unmapped" })],
        {},
      );
      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    });

    it("uses rejected and partially_addressed icons, and a fallback icon for unknown statuses", async () => {
      await svc.postRemediationResolutions(
        "test-repo",
        5,
        [
          makeResolution({ findingId: "f1", status: "rejected" }),
          makeResolution({ findingId: "f2", status: "partially_addressed" }),
          makeResolution({ findingId: "f3", status: "weird_status" as ResolutionItem["status"] }),
        ],
        { f1: 1, f2: 2, f3: 3 },
      );
      const summaryBody = githubClient.commentOnPR.mock.calls[0]![2] as string;
      expect(summaryBody).toContain(":no_entry_sign:");
      expect(summaryBody).toContain(":warning:");
      expect(summaryBody).toContain(":grey_question:");
    });
  });
});
