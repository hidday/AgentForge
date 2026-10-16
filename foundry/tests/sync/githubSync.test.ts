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
    branchName: "ai/run-1",
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
    file: "src/foo.ts",
    lineHint: 10,
    title: "Possible null deref",
    details: "This may crash.",
    ...overrides,
  };
}

function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
  return {
    findingId: "f1",
    status: "accepted",
    action: "Fixed the bug",
    rationale: "Added a null check",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts", "src/b.ts"],
    checks: {
      lint: { status: "pass", details: "No issues" },
      typecheck: { status: "pass", details: "No errors" },
      tests: { status: "pass", details: "All green" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Clean implementation",
    ...overrides,
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
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
    it("is a no-op when the run has no prNumber", async () => {
      const run = makeRun({ prNumber: null, state: RunState.ReadyForHumanReview });

      await service.syncState(run);

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when state is ReadyForHumanReview", async () => {
      const run = makeRun({ prNumber: 7, state: RunState.ReadyForHumanReview, repo: "acme/widgets" });

      await service.syncState(run);

      expect(githubClient.markPRReady).toHaveBeenCalledWith("acme/widgets", 7);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "acme/widgets",
        7,
        "All AI checks passed. Ready for human review.",
      );
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 7 },
        "Marked PR ready for review",
      );
    });

    it("does nothing when prNumber is set but state is not ReadyForHumanReview", async () => {
      const run = makeRun({ prNumber: 7, state: RunState.Implementing });

      await service.syncState(run);

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
      expect(logger.debug).not.toHaveBeenCalled();
    });
  });

  describe("postReviewFindings", () => {
    it("returns an empty map and submits an APPROVE review when there are no findings", async () => {
      const result = await service.postReviewFindings("acme/widgets", 7, [], "approved");

      expect(result.size).toBe(0);
      expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        7,
        expect.stringContaining("Approved"),
        "APPROVE",
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: "acme/widgets",
          prNumber: 7,
          findingsCount: 0,
          verdict: "approved",
          mappedComments: 0,
        }),
        "Posted review findings as PR review comments",
      );
    });

    it("posts one inline comment per finding and maps finding id to comment id", async () => {
      githubClient.createPRReviewComment
        .mockResolvedValueOnce(1001)
        .mockResolvedValueOnce(1002);
      const findings = [
        makeFinding({ id: "f1", severity: "blocker", title: "Bug A" }),
        makeFinding({ id: "f2", severity: "nit", title: "Bug B", file: "src/bar.ts", lineHint: 5 }),
      ];

      const result = await service.postReviewFindings("acme/widgets", 7, findings, "changes_requested");

      expect(githubClient.createPRReviewComment).toHaveBeenCalledTimes(2);
      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        1,
        "acme/widgets",
        7,
        expect.stringContaining("**[BLOCKER]** Bug A"),
        "src/foo.ts",
        10,
      );
      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        2,
        "acme/widgets",
        7,
        expect.stringContaining("**[NIT]** Bug B"),
        "src/bar.ts",
        5,
      );
      expect(result.get("f1")).toBe(1001);
      expect(result.get("f2")).toBe(1002);
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        7,
        expect.stringContaining("Changes Requested"),
        "REQUEST_CHANGES",
      );
    });

    it("skips mapping a finding whose createPRReviewComment call returns a falsy id", async () => {
      githubClient.createPRReviewComment.mockResolvedValueOnce(0);
      const findings = [makeFinding({ id: "f1" })];

      const result = await service.postReviewFindings("acme/widgets", 7, findings, "approved");

      expect(result.has("f1")).toBe(false);
    });

    it("includes the finding count in the review summary body", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(1);
      const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2" })];

      await service.postReviewFindings("acme/widgets", 7, findings, "approved");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        7,
        expect.stringContaining("2 finding(s) posted as inline comments."),
        "APPROVE",
      );
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("formats a report with passing checks and a small file list without collapsing", async () => {
      const report = makeExecutionReport({
        filesChanged: ["src/a.ts", "src/b.ts"],
        notes: [],
      });

      await service.postExecutionReportUpdate("acme/widgets", 7, report);

      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("Score: 90%");
      expect(body).toContain(":white_check_mark: **Lint**");
      expect(body).toContain("### Files changed (2)");
      expect(body).not.toContain("<details>");
      expect(body).not.toContain("### Notes");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: "acme/widgets",
          prNumber: 7,
          executionVersion: report.executionVersion,
          score: report.score,
          filesChanged: 2,
        }),
        "Posted execution report update to PR",
      );
    });

    it("collapses the files list behind <details> when more than 8 files changed", async () => {
      const report = makeExecutionReport({
        filesChanged: Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`),
      });

      await service.postExecutionReportUpdate("acme/widgets", 7, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
      expect(body).toContain("</details>");
    });

    it("omits the files section entirely when no files changed", async () => {
      const report = makeExecutionReport({ filesChanged: [] });

      await service.postExecutionReportUpdate("acme/widgets", 7, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("Files changed");
    });

    it("renders failing and skipped check icons", async () => {
      const report = makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "2 errors" },
          typecheck: { status: "skip", details: "not run" },
          tests: { status: "pass", details: "ok" },
        },
      });

      await service.postExecutionReportUpdate("acme/widgets", 7, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain(":x: **Lint** -- 2 errors");
      expect(body).toContain(":heavy_minus_sign: **Typecheck** -- not run");
      expect(body).toContain(":white_check_mark: **Tests** -- ok");
    });

    it("includes a Notes section when notes are present", async () => {
      const report = makeExecutionReport({ notes: ["Watch out for X", "Y is deprecated"] });

      await service.postExecutionReportUpdate("acme/widgets", 7, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("### Notes");
      expect(body).toContain("- Watch out for X");
      expect(body).toContain("- Y is deprecated");
    });
  });

  describe("postRemediationResolutions", () => {
    it("replies to each PR comment mapped in commentMap and posts a summary table", async () => {
      const resolutions = [
        makeResolution({ findingId: "f1", status: "accepted" }),
        makeResolution({ findingId: "f2", status: "rejected" }),
      ];
      const commentMap = { f1: 1001, f2: 1002 };

      await service.postRemediationResolutions("acme/widgets", 7, resolutions, commentMap);

      expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(2);
      expect(githubClient.replyToReviewComment).toHaveBeenNthCalledWith(
        1,
        "acme/widgets",
        7,
        1001,
        expect.stringContaining(":white_check_mark: **accepted**"),
      );
      expect(githubClient.replyToReviewComment).toHaveBeenNthCalledWith(
        2,
        "acme/widgets",
        7,
        1002,
        expect.stringContaining(":no_entry_sign: **rejected**"),
      );
      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
      const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summaryBody).toContain("## AI Remediation Summary");
      expect(summaryBody).toContain("f1");
      expect(summaryBody).toContain("f2");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: "acme/widgets",
          prNumber: 7,
          resolutionCount: 2,
          repliedTo: 2,
        }),
        "Posted remediation resolutions to PR",
      );
    });

    it("skips replying when a resolution's findingId has no entry in commentMap", async () => {
      const resolutions = [makeResolution({ findingId: "unmapped" })];

      await service.postRemediationResolutions("acme/widgets", 7, resolutions, {});

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    });

    it("uses the fallback icon for an unrecognized resolution status", async () => {
      const resolutions = [
        { findingId: "f1", status: "weird_status", action: "x", rationale: "y" } as ResolutionItem,
      ];
      const commentMap = { f1: 1001 };

      await service.postRemediationResolutions("acme/widgets", 7, resolutions, commentMap);

      const replyBody = githubClient.replyToReviewComment.mock.calls[0][3] as string;
      expect(replyBody).toContain(":grey_question:");
      const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summaryBody).toContain(":grey_question:");
    });

    it("renders partially_addressed status with a warning icon and replaces underscores in label", async () => {
      const resolutions = [makeResolution({ findingId: "f1", status: "partially_addressed" })];
      const commentMap = { f1: 1001 };

      await service.postRemediationResolutions("acme/widgets", 7, resolutions, commentMap);

      const replyBody = githubClient.replyToReviewComment.mock.calls[0][3] as string;
      expect(replyBody).toContain(":warning:");
      expect(replyBody).toContain("**partially addressed**");
    });

    it("produces an empty-row summary table and reports repliedTo 0 when there are no resolutions", async () => {
      await service.postRemediationResolutions("acme/widgets", 7, [], {});

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ resolutionCount: 0, repliedTo: 0 }),
        "Posted remediation resolutions to PR",
      );
    });
  });
});
