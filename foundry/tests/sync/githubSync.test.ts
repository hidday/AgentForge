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
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Title",
    linearIssueUrl: null,
    repo: "owner/repo",
    branchName: "ai/issue-1",
    prNumber: 42,
    state: RunState.Implementing,
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
    type: "correctness",
    file: "src/a.ts",
    title: "Bug found",
    details: "Details about the bug.",
    ...overrides,
  };
}

function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
    filesChanged: ["src/a.ts", "src/b.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "fail", details: "1 failing" },
    },
    notes: ["Followed existing patterns."],
    prDraftCreated: true,
    score: 0.75,
    scoreRationale: "Mostly correct, one failing test.",
    ...overrides,
  };
}

describe("GitHubSyncService", () => {
  let githubClient: ReturnType<typeof makeGithubClient>;
  let service: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGithubClient();
    service = new GitHubSyncService(githubClient as never, makeLogger() as never);
  });

  describe("syncState", () => {
    it("does nothing when the run has no PR number", async () => {
      await service.syncState(makeRun({ prNumber: null }));
      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("does nothing when the run is not ReadyForHumanReview", async () => {
      await service.syncState(makeRun({ state: RunState.Implementing }));
      expect(githubClient.markPRReady).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when ReadyForHumanReview", async () => {
      await service.syncState(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42 }));
      expect(githubClient.markPRReady).toHaveBeenCalledWith("owner/repo", 42);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.stringContaining("Ready for human review"),
      );
    });
  });

  describe("postReviewFindings", () => {
    it("posts each finding as an inline comment and maps finding id to comment id", async () => {
      githubClient.createPRReviewComment.mockResolvedValueOnce(101).mockResolvedValueOnce(102);
      const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2", lineHint: 10 })];

      const map = await service.postReviewFindings("owner/repo", 42, findings, "changes_requested");

      expect(map.get("f1")).toBe(101);
      expect(map.get("f2")).toBe(102);
      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        2,
        "owner/repo",
        42,
        expect.stringContaining("IMPORTANT"),
        "src/a.ts",
        10,
      );
    });

    it("skips mapping a finding when createPRReviewComment returns 0 (comment could not be posted)", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(0);
      const map = await service.postReviewFindings("owner/repo", 42, [makeFinding()], "approved");
      expect(map.size).toBe(0);
    });

    it("submits an APPROVE review when the verdict is 'approved'", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(1);
      await service.postReviewFindings("owner/repo", 42, [makeFinding()], "approved");
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.stringContaining("Approved"),
        "APPROVE",
      );
    });

    it("submits a REQUEST_CHANGES review for any non-approved verdict", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(1);
      await service.postReviewFindings("owner/repo", 42, [makeFinding()], "changes_requested");
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.stringContaining("Changes Requested"),
        "REQUEST_CHANGES",
      );
    });

    it("handles an empty findings list", async () => {
      const map = await service.postReviewFindings("owner/repo", 42, [], "approved");
      expect(map.size).toBe(0);
      expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
      expect(githubClient.submitPRReview).toHaveBeenCalled();
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("posts a comment including the score and check statuses", async () => {
      await service.postExecutionReportUpdate("owner/repo", 42, makeReport());
      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("75%");
      expect(body).toContain("Lint");
      expect(body).toContain(":x:"); // failing tests check
      expect(body).toContain(":white_check_mark:"); // passing lint/typecheck
    });

    it("lists files inline when at or below the collapse threshold", async () => {
      await service.postExecutionReportUpdate(
        "owner/repo",
        42,
        makeReport({ filesChanged: ["a.ts", "b.ts"] }),
      );
      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("Files changed (2)");
      expect(body).not.toContain("<details>");
    });

    it("collapses the files list behind <details> above the threshold", async () => {
      const manyFiles = Array.from({ length: 9 }, (_, i) => `file-${String(i)}.ts`);
      await service.postExecutionReportUpdate(
        "owner/repo",
        42,
        makeReport({ filesChanged: manyFiles }),
      );
      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
    });

    it("omits the files section entirely when no files changed", async () => {
      await service.postExecutionReportUpdate("owner/repo", 42, makeReport({ filesChanged: [] }));
      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("Files changed");
    });

    it("omits the notes section when there are no notes", async () => {
      await service.postExecutionReportUpdate("owner/repo", 42, makeReport({ notes: [] }));
      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("### Notes");
    });

    it("includes a skip icon for a check with status 'skip'", async () => {
      await service.postExecutionReportUpdate(
        "owner/repo",
        42,
        makeReport({
          checks: {
            lint: { status: "skip", details: "n/a" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "pass", details: "ok" },
          },
        }),
      );
      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain(":heavy_minus_sign:");
    });
  });

  describe("postRemediationResolutions", () => {
    it("replies on each resolution's mapped comment and posts a summary table", async () => {
      const resolutions: ResolutionItem[] = [
        { findingId: "f1", status: "accepted", action: "Fixed null check", rationale: "Valid bug" },
        { findingId: "f2", status: "rejected", action: "No change", rationale: "Not reproducible" },
      ];
      await service.postRemediationResolutions(
        "owner/repo",
        42,
        resolutions,
        { f1: 101, f2: 102 },
      );

      expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(2);
      expect(githubClient.replyToReviewComment).toHaveBeenNthCalledWith(
        1,
        "owner/repo",
        42,
        101,
        expect.stringContaining("accepted"),
      );
      const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain("f1");
      expect(summary).toContain("f2");
    });

    it("does not reply when a resolution has no matching GitHub comment id", async () => {
      const resolutions: ResolutionItem[] = [
        { findingId: "unmapped", status: "accepted", action: "Fixed", rationale: "ok" },
      ];
      await service.postRemediationResolutions("owner/repo", 42, resolutions, {});
      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    });

    it("uses a question-mark icon for an unrecognized resolution status", async () => {
      const resolutions = [
        { findingId: "f1", status: "weird" as ResolutionItem["status"], action: "x", rationale: "y" },
      ];
      await service.postRemediationResolutions("owner/repo", 42, resolutions, { f1: 1 });
      const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain(":grey_question:");
    });
  });
});
