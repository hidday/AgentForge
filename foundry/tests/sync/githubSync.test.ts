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
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: "ai/run-1",
    prNumber: 5,
    state: RunState.ReadyForHumanReview,
    planVersion: 1,
    approvedPlanVersion: 1,
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
    summary: "Did the work",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "fail", details: "2 errors" },
      tests: { status: "skip", details: "not run" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "mostly good",
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

    it("marks the PR ready and comments when the run is ReadyForHumanReview", async () => {
      await service.syncState(makeRun({ prNumber: 5, state: RunState.ReadyForHumanReview }));
      expect(githubClient.markPRReady).toHaveBeenCalledWith("org/repo", 5);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "org/repo",
        5,
        "All AI checks passed. Ready for human review.",
      );
      expect(logger.debug).toHaveBeenCalled();
    });

    it("does nothing when the run has a PR but is in another state", async () => {
      await service.syncState(makeRun({ prNumber: 5, state: RunState.Implementing }));
      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });
  });

  describe("postReviewFindings", () => {
    it("maps findings to comment ids, skipping zero (unposted) ids, and approves", async () => {
      githubClient.createPRReviewComment
        .mockResolvedValueOnce(201)
        .mockResolvedValueOnce(0);

      const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2", lineHint: undefined })];
      const map = await service.postReviewFindings("org/repo", 5, findings, "approved");

      expect(map.get("f1")).toBe(201);
      expect(map.has("f2")).toBe(false);
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "org/repo",
        5,
        expect.stringContaining("Approved"),
        "APPROVE",
      );
      expect(logger.info).toHaveBeenCalled();
    });

    it("requests changes when the verdict is not approved", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(300);
      await service.postReviewFindings("org/repo", 5, [makeFinding()], "changes_requested");
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "org/repo",
        5,
        expect.stringContaining("Changes Requested"),
        "REQUEST_CHANGES",
      );
    });

    it("passes file and lineHint through to createPRReviewComment", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(1);
      const finding = makeFinding({ file: "src/b.ts", lineHint: 12, severity: "blocker" });
      await service.postReviewFindings("org/repo", 5, [finding], "approved");
      expect(githubClient.createPRReviewComment).toHaveBeenCalledWith(
        "org/repo",
        5,
        expect.stringContaining("[BLOCKER]"),
        "src/b.ts",
        12,
      );
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("renders checks, an uncollapsed file list, and skips the notes section when empty", async () => {
      const report = makeExecutionReport({ filesChanged: ["a.ts", "b.ts"], notes: [] });
      await service.postExecutionReportUpdate("org/repo", 5, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("Score: 90%");
      expect(body).toContain(":white_check_mark: **Lint**");
      expect(body).toContain(":x: **Typecheck**");
      expect(body).toContain(":heavy_minus_sign: **Tests**");
      expect(body).toContain("Files changed (2)");
      expect(body).not.toContain("<details>");
      expect(body).not.toContain("### Notes");
      expect(logger.info).toHaveBeenCalled();
    });

    it("collapses the file list when more than 8 files changed", async () => {
      const files = Array.from({ length: 9 }, (_, i) => `file${String(i)}.ts`);
      const report = makeExecutionReport({ filesChanged: files });
      await service.postExecutionReportUpdate("org/repo", 5, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
    });

    it("omits the files section entirely when no files changed, and includes notes when present", async () => {
      const report = makeExecutionReport({ filesChanged: [], notes: ["Watch out for X", "Also Y"] });
      await service.postExecutionReportUpdate("org/repo", 5, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("Files changed");
      expect(body).toContain("### Notes");
      expect(body).toContain("- Watch out for X");
      expect(body).toContain("- Also Y");
    });
  });

  describe("postRemediationResolutions", () => {
    it("replies only to findings present in the comment map, and builds a summary table", async () => {
      const resolutions: ResolutionItem[] = [
        { findingId: "f1", status: "accepted", action: "Fixed", rationale: "Good catch" },
        { findingId: "f2", status: "rejected", action: "No change", rationale: "Not valid" },
        { findingId: "f3", status: "partially_addressed", action: "Partial", rationale: "Time" },
      ];
      const commentMap = { f1: 100, f2: 200 };

      await service.postRemediationResolutions("org/repo", 5, resolutions, commentMap);

      expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(2);
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "org/repo",
        5,
        100,
        expect.stringContaining(":white_check_mark:"),
      );
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "org/repo",
        5,
        200,
        expect.stringContaining(":no_entry_sign:"),
      );

      const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain("## AI Remediation Summary");
      expect(summary).toContain(":warning:");
      expect(summary).toContain("f3");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ resolutionCount: 3, repliedTo: 2 }),
        "Posted remediation resolutions to PR",
      );
    });

    it("falls back to a grey question icon for an unrecognized status", async () => {
      const resolutions = [
        {
          findingId: "f1",
          status: "unknown_status" as unknown as ResolutionItem["status"],
          action: "N/A",
          rationale: "N/A",
        },
      ];
      await service.postRemediationResolutions("org/repo", 5, resolutions, {});

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
      const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain(":grey_question:");
    });

    it("uses the grey question icon in the reply body too when the finding has a comment id", async () => {
      const resolutions = [
        {
          findingId: "f1",
          status: "unknown_status" as unknown as ResolutionItem["status"],
          action: "N/A",
          rationale: "N/A",
        },
      ];
      await service.postRemediationResolutions("org/repo", 5, resolutions, { f1: 500 });

      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "org/repo",
        5,
        500,
        expect.stringContaining(":grey_question:"),
      );
    });
  });
});
