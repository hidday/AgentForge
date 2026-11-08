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
    linearIssueId: "issue-1",
    linearIssueIdentifier: "PRY-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: "ai/issue-1",
    prNumber: 42,
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

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "important",
    type: "bug",
    file: "src/a.ts",
    title: "Title",
    details: "Details",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Summary",
    filesChanged: [],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "fail", details: "1 failing" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.5,
    scoreRationale: "rationale",
    ...overrides,
  };
}

describe("GitHubSyncService", () => {
  describe("syncState", () => {
    it("does nothing when the run has no PR number", async () => {
      const gh = makeGitHubClient();
      const svc = new GitHubSyncService(gh as never, makeLogger() as never);

      await svc.syncState(makeRun({ prNumber: null }));

      expect(gh.markPRReady).not.toHaveBeenCalled();
      expect(gh.commentOnPR).not.toHaveBeenCalled();
    });

    it("does nothing for states other than ReadyForHumanReview", async () => {
      const gh = makeGitHubClient();
      const svc = new GitHubSyncService(gh as never, makeLogger() as never);

      await svc.syncState(makeRun({ state: RunState.Implementing }));

      expect(gh.markPRReady).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when the run reaches ReadyForHumanReview", async () => {
      const gh = makeGitHubClient();
      const svc = new GitHubSyncService(gh as never, makeLogger() as never);

      await svc.syncState(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7 }));

      expect(gh.markPRReady).toHaveBeenCalledWith("acme/widgets", 7);
      expect(gh.commentOnPR).toHaveBeenCalledWith(
        "acme/widgets",
        7,
        expect.stringContaining("Ready for human review"),
      );
    });
  });

  describe("postReviewFindings", () => {
    it("posts each finding as a review comment and maps finding id to GitHub comment id", async () => {
      const gh = makeGitHubClient();
      gh.createPRReviewComment.mockResolvedValueOnce(901).mockResolvedValueOnce(902);
      const svc = new GitHubSyncService(gh as never, makeLogger() as never);

      const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2", lineHint: 10 })];
      const map = await svc.postReviewFindings("acme/widgets", 7, findings, "changes_requested");

      expect(map.get("f1")).toBe(901);
      expect(map.get("f2")).toBe(902);
      expect(gh.createPRReviewComment).toHaveBeenNthCalledWith(
        2,
        "acme/widgets",
        7,
        expect.stringContaining("Title"),
        "src/a.ts",
        10,
      );
      expect(gh.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        7,
        expect.stringContaining("Changes Requested"),
        "REQUEST_CHANGES",
      );
    });

    it("omits findings from the map when createPRReviewComment returns 0 (comment skipped)", async () => {
      const gh = makeGitHubClient();
      gh.createPRReviewComment.mockResolvedValue(0);
      const svc = new GitHubSyncService(gh as never, makeLogger() as never);

      const map = await svc.postReviewFindings("acme/widgets", 7, [makeFinding()], "approved");

      expect(map.size).toBe(0);
      expect(gh.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        7,
        expect.stringContaining("Approved"),
        "APPROVE",
      );
    });

    it("handles an empty findings list", async () => {
      const gh = makeGitHubClient();
      const svc = new GitHubSyncService(gh as never, makeLogger() as never);

      const map = await svc.postReviewFindings("acme/widgets", 7, [], "approved");

      expect(map.size).toBe(0);
      expect(gh.createPRReviewComment).not.toHaveBeenCalled();
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("renders a short file list inline when at or below the collapse threshold", async () => {
      const gh = makeGitHubClient();
      const svc = new GitHubSyncService(gh as never, makeLogger() as never);

      await svc.postExecutionReportUpdate(
        "acme/widgets",
        7,
        makeExecutionReport({ filesChanged: ["a.ts", "b.ts"], notes: ["note 1"] }),
      );

      const body = gh.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("Files changed (2)");
      expect(body).not.toContain("<details>");
      expect(body).toContain("note 1");
    });

    it("collapses the file list into a <details> block above the threshold", async () => {
      const gh = makeGitHubClient();
      const svc = new GitHubSyncService(gh as never, makeLogger() as never);
      const files = Array.from({ length: 9 }, (_, i) => `file${String(i)}.ts`);

      await svc.postExecutionReportUpdate("acme/widgets", 7, makeExecutionReport({ filesChanged: files }));

      const body = gh.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
    });

    it("omits the files and notes sections when both are empty", async () => {
      const gh = makeGitHubClient();
      const svc = new GitHubSyncService(gh as never, makeLogger() as never);

      await svc.postExecutionReportUpdate(
        "acme/widgets",
        7,
        makeExecutionReport({ filesChanged: [], notes: [] }),
      );

      const body = gh.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("Files changed");
      expect(body).not.toContain("### Notes");
    });

    it("renders the correct status icon for pass/fail/other checks", async () => {
      const gh = makeGitHubClient();
      const svc = new GitHubSyncService(gh as never, makeLogger() as never);

      await svc.postExecutionReportUpdate(
        "acme/widgets",
        7,
        makeExecutionReport({
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "fail", details: "errors" },
            tests: { status: "skip", details: "skipped" },
          },
        }),
      );

      const body = gh.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain(":white_check_mark: **Lint**");
      expect(body).toContain(":x: **Typecheck**");
      expect(body).toContain(":heavy_minus_sign: **Tests**");
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

    it("replies to each mapped finding and posts a summary table", async () => {
      const gh = makeGitHubClient();
      const svc = new GitHubSyncService(gh as never, makeLogger() as never);

      await svc.postRemediationResolutions(
        "acme/widgets",
        7,
        [makeResolution({ findingId: "f1", status: "rejected" }), makeResolution({ findingId: "f2" })],
        { f1: 901 },
      );

      expect(gh.replyToReviewComment).toHaveBeenCalledTimes(1);
      expect(gh.replyToReviewComment).toHaveBeenCalledWith(
        "acme/widgets",
        7,
        901,
        expect.stringContaining("rejected"),
      );
      const summary = gh.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain("AI Remediation Summary");
      expect(summary).toContain("f1");
      expect(summary).toContain("f2");
    });

    it("skips replying when a resolution has no corresponding GitHub comment id", async () => {
      const gh = makeGitHubClient();
      const svc = new GitHubSyncService(gh as never, makeLogger() as never);

      await svc.postRemediationResolutions("acme/widgets", 7, [makeResolution({ findingId: "f-unmapped" })], {});

      expect(gh.replyToReviewComment).not.toHaveBeenCalled();
      expect(gh.commentOnPR).toHaveBeenCalled();
    });

    it("falls back to a question mark icon for an unrecognised status", async () => {
      const gh = makeGitHubClient();
      const svc = new GitHubSyncService(gh as never, makeLogger() as never);

      await svc.postRemediationResolutions(
        "acme/widgets",
        7,
        [makeResolution({ findingId: "f1", status: "weird" as ResolutionItem["status"] })],
        { f1: 901 },
      );

      expect(gh.replyToReviewComment).toHaveBeenCalledWith(
        "acme/widgets",
        7,
        901,
        expect.stringContaining(":grey_question:"),
      );
    });
  });
});
