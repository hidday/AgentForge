import { describe, it, expect, vi } from "vitest";
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
    repo: "org/repo",
    branchName: "ai/branch",
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
    title: "Issue title",
    details: "Issue details",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Summary text",
    filesChanged: [],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "pass", details: "clean" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "solid",
    ...overrides,
  };
}

describe("GitHubSyncService", () => {
  describe("syncState", () => {
    it("does nothing when the run has no PR number", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);
      const run = makeRun({ prNumber: null });

      await svc.syncState(run);

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when the run is ReadyForHumanReview", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);
      const run = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7 });

      await svc.syncState(run);

      expect(githubClient.markPRReady).toHaveBeenCalledWith("org/repo", 7);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "org/repo",
        7,
        "All AI checks passed. Ready for human review.",
      );
    });

    it("does nothing for a PR present but in a non-ReadyForHumanReview state", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);
      const run = makeRun({ state: RunState.Implementing, prNumber: 7 });

      await svc.syncState(run);

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });
  });

  describe("postReviewFindings", () => {
    it("posts each finding as a review comment and maps id to comment id", async () => {
      const githubClient = makeGithubClient();
      githubClient.createPRReviewComment
        .mockResolvedValueOnce(500)
        .mockResolvedValueOnce(501);
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      const findings = [
        makeFinding({ id: "f1", severity: "blocker", lineHint: 10 }),
        makeFinding({ id: "f2", severity: "nit" }),
      ];

      const map = await svc.postReviewFindings("org/repo", 7, findings, "changes_requested");

      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        1,
        "org/repo",
        7,
        expect.stringContaining("[BLOCKER]"),
        "src/a.ts",
        10,
      );
      expect(map.get("f1")).toBe(500);
      expect(map.get("f2")).toBe(501);
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "org/repo",
        7,
        expect.stringContaining("Changes Requested"),
        "REQUEST_CHANGES",
      );
    });

    it("does not map findings whose comment creation returned 0 (skipped)", async () => {
      const githubClient = makeGithubClient();
      githubClient.createPRReviewComment.mockResolvedValue(0);
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      const map = await svc.postReviewFindings("org/repo", 7, [makeFinding()], "approved");

      expect(map.size).toBe(0);
    });

    it("submits an APPROVE review when the verdict is approved", async () => {
      const githubClient = makeGithubClient();
      githubClient.createPRReviewComment.mockResolvedValue(1);
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.postReviewFindings("org/repo", 7, [makeFinding()], "approved");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "org/repo",
        7,
        expect.stringContaining("Approved"),
        "APPROVE",
      );
    });

    it("handles an empty findings list", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      const map = await svc.postReviewFindings("org/repo", 7, [], "approved");

      expect(map.size).toBe(0);
      expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
      expect(githubClient.submitPRReview).toHaveBeenCalled();
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("renders checks, and omits files/notes sections when both are empty", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);
      const report = makeExecutionReport();

      await svc.postExecutionReportUpdate("org/repo", 7, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("Score: 90%");
      expect(body).toContain(":white_check_mark: **Lint**");
      expect(body).not.toContain("Files changed");
      expect(body).not.toContain("### Notes");
    });

    it("renders a flat file list when filesChanged is small", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);
      const report = makeExecutionReport({
        filesChanged: ["a.ts", "b.ts"],
        notes: ["Note one"],
      });

      await svc.postExecutionReportUpdate("org/repo", 7, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("### Files changed (2)");
      expect(body).toContain("`a.ts`");
      expect(body).not.toContain("<details>");
      expect(body).toContain("### Notes");
      expect(body).toContain("- Note one");
    });

    it("collapses the file list into a <details> block above the threshold", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);
      const files = Array.from({ length: 9 }, (_, i) => `file${String(i)}.ts`);
      const report = makeExecutionReport({ filesChanged: files });

      await svc.postExecutionReportUpdate("org/repo", 7, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
    });

    it("renders fail and skip check icons", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);
      const report = makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "issues found" },
          typecheck: { status: "skip", details: "not run" },
          tests: { status: "pass", details: "all green" },
        },
      });

      await svc.postExecutionReportUpdate("org/repo", 7, report);

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
        action: "Fixed it",
        rationale: "Because",
        ...overrides,
      };
    }

    it("replies to mapped findings and posts a summary table", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      const resolutions = [
        makeResolution({ findingId: "f1", status: "accepted" }),
        makeResolution({ findingId: "f2", status: "rejected" }),
      ];
      const commentMap = { f1: 500 };

      await svc.postRemediationResolutions("org/repo", 7, resolutions, commentMap);

      expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(1);
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "org/repo",
        7,
        500,
        expect.stringContaining("accepted"),
      );
      const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summaryBody).toContain("AI Remediation Summary");
      expect(summaryBody).toContain("f1");
      expect(summaryBody).toContain("f2");
    });

    it("skips replying for resolutions with no mapped GitHub comment id", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.postRemediationResolutions("org/repo", 7, [makeResolution()], {});

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).toHaveBeenCalled();
    });

    it("uses the fallback icon for an unrecognized status", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      const resolutions = [
        { findingId: "f1", status: "weird_status", action: "a", rationale: "r" } as unknown as ResolutionItem,
      ];

      await svc.postRemediationResolutions("org/repo", 7, resolutions, { f1: 500 });

      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "org/repo",
        7,
        500,
        expect.stringContaining(":grey_question:"),
      );
    });

    it("handles an empty resolutions list", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.postRemediationResolutions("org/repo", 7, [], {});

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "org/repo",
        7,
        expect.stringContaining("AI Remediation Summary"),
      );
    });
  });
});
