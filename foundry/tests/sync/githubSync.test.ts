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
    linearIssueId: "issue-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "owner/repo",
    branchName: "ai/run-1",
    prNumber: 42,
    state: RunState.ReadyForHumanReview,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
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

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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
      await service.syncState(makeRun({ prNumber: null }));
      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when the run is ready for human review", async () => {
      const run = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7, repo: "o/r" });
      await service.syncState(run);

      expect(githubClient.markPRReady).toHaveBeenCalledWith("o/r", 7);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "o/r",
        7,
        "All AI checks passed. Ready for human review.",
      );
    });

    it("does nothing when the run has a PR but is in a different state", async () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 7 });
      await service.syncState(run);

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });
  });

  describe("postReviewFindings", () => {
    it("posts each finding as a review comment and maps non-zero comment ids", async () => {
      const findings = [
        makeFinding({ id: "f1", lineHint: 10 }),
        makeFinding({ id: "f2", lineHint: undefined }),
      ];
      githubClient.createPRReviewComment.mockResolvedValueOnce(101).mockResolvedValueOnce(0);

      const map = await service.postReviewFindings("o/r", 7, findings, "approved");

      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        1,
        "o/r",
        7,
        expect.stringContaining("[IMPORTANT]"),
        "src/a.ts",
        10,
      );
      expect(map.get("f1")).toBe(101);
      expect(map.has("f2")).toBe(false);
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "o/r",
        7,
        expect.stringContaining("Approved"),
        "APPROVE",
      );
    });

    it("submits REQUEST_CHANGES when the verdict is not approved", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(1);
      await service.postReviewFindings("o/r", 7, [makeFinding()], "changes_requested");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "o/r",
        7,
        expect.stringContaining("Changes Requested"),
        "REQUEST_CHANGES",
      );
    });

    it("handles an empty findings list", async () => {
      const map = await service.postReviewFindings("o/r", 7, [], "approved");
      expect(map.size).toBe(0);
      expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
      expect(githubClient.submitPRReview).toHaveBeenCalled();
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("renders pass/fail/skip icons and an inline files-changed section below the threshold", async () => {
      const report = makeExecutionReport({
        filesChanged: ["src/a.ts", "src/b.ts"],
        notes: ["Note one"],
        checks: {
          lint: { status: "pass", details: "clean" },
          typecheck: { status: "fail", details: "type error" },
          tests: { status: "skip", details: "not run" },
        },
      });

      await service.postExecutionReportUpdate("o/r", 7, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain(":white_check_mark: **Lint**");
      expect(body).toContain(":x: **Typecheck**");
      expect(body).toContain(":heavy_minus_sign: **Tests**");
      expect(body).toContain("Files changed (2)");
      expect(body).not.toContain("<details>");
      expect(body).toContain("### Notes");
      expect(body).toContain("Note one");
    });

    it("collapses the files-changed section into a <details> block above the threshold", async () => {
      const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);
      const report = makeExecutionReport({ filesChanged: manyFiles });

      await service.postExecutionReportUpdate("o/r", 7, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
    });

    it("omits the files-changed and notes sections when both are empty", async () => {
      const report = makeExecutionReport({ filesChanged: [], notes: [] });

      await service.postExecutionReportUpdate("o/r", 7, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("Files changed");
      expect(body).not.toContain("### Notes");
    });
  });

  describe("postRemediationResolutions", () => {
    it("replies to mapped findings and posts a summary table", async () => {
      const resolutions: ResolutionItem[] = [
        { findingId: "f1", status: "accepted", action: "Fixed it", rationale: "Was a bug" },
        { findingId: "f2", status: "rejected", action: "No change", rationale: "Not valid" },
        {
          findingId: "f3",
          status: "partially_addressed",
          action: "Partial fix",
          rationale: "Complex",
        },
      ];
      const commentMap = { f1: 101, f3: 103 };

      await service.postRemediationResolutions("o/r", 7, resolutions, commentMap);

      expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(2);
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "o/r",
        7,
        101,
        expect.stringContaining("accepted"),
      );
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "o/r",
        7,
        103,
        expect.stringContaining("partially addressed"),
      );

      const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain("AI Remediation Summary");
      expect(summary).toContain("f1");
      expect(summary).toContain("f2");
      expect(summary).toContain("f3");
    });

    it("uses a fallback icon for an unrecognized resolution status", async () => {
      const resolutions = [
        { findingId: "f1", status: "weird_status", action: "x", rationale: "y" },
      ] as unknown as ResolutionItem[];

      await service.postRemediationResolutions("o/r", 7, resolutions, {});

      const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain(":grey_question:");
    });

    it("uses the fallback icon in the reply body too when the status is unrecognized but mapped to a comment", async () => {
      const resolutions = [
        { findingId: "f1", status: "weird_status", action: "x", rationale: "y" },
      ] as unknown as ResolutionItem[];

      await service.postRemediationResolutions("o/r", 7, resolutions, { f1: 101 });

      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "o/r",
        7,
        101,
        expect.stringContaining(":grey_question:"),
      );
    });

    it("handles an empty resolutions list without replying or erroring", async () => {
      await service.postRemediationResolutions("o/r", 7, [], {});

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).toHaveBeenCalled();
    });
  });
});
