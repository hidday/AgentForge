import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Finding } from "../../src/schemas/review.js";
import type { ResolutionItem } from "../../src/schemas/remediation.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { GitHubClient } from "../../src/github/githubClient.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeFakeGitHubClient() {
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
    repo: "acme/widgets",
    branchName: "feature/foo",
    prNumber: 42,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 1,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
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
    details: "This may throw if x is undefined.",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "no issues" },
      typecheck: { status: "pass", details: "no issues" },
      tests: { status: "pass", details: "42 passed" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.95,
    scoreRationale: "All checks passed.",
    ...overrides,
  };
}

describe("GitHubSyncService", () => {
  let githubClient: ReturnType<typeof makeFakeGitHubClient>;
  let logger: ReturnType<typeof makeLogger>;
  let service: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeFakeGitHubClient();
    logger = makeLogger();
    service = new GitHubSyncService(githubClient as unknown as GitHubClient, logger as never);
  });

  describe("syncState", () => {
    it("does nothing when the run has no PR yet", async () => {
      const run = makeRun({ prNumber: null, state: RunState.ReadyForHumanReview });

      await service.syncState(run);

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("does nothing when the run has a PR but is not ReadyForHumanReview", async () => {
      const run = makeRun({ state: RunState.Implementing });

      await service.syncState(run);

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when the run is ReadyForHumanReview", async () => {
      const run = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42 });

      await service.syncState(run);

      expect(githubClient.markPRReady).toHaveBeenCalledWith("acme/widgets", 42);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        "All AI checks passed. Ready for human review.",
      );
      expect(logger.debug).toHaveBeenCalled();
    });

    it("propagates an error from the underlying GitHub client", async () => {
      const run = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42 });
      githubClient.markPRReady.mockRejectedValue(new Error("GitHub API down"));

      await expect(service.syncState(run)).rejects.toThrow("GitHub API down");
    });
  });

  describe("postReviewFindings", () => {
    it("posts each finding as an inline comment and maps ids by findingId", async () => {
      const findings = [
        makeFinding({ id: "f1", severity: "blocker", lineHint: 10 }),
        makeFinding({ id: "f2", severity: "nit", file: "src/b.ts" }),
      ];
      githubClient.createPRReviewComment
        .mockResolvedValueOnce(501)
        .mockResolvedValueOnce(502);

      const commentMap = await service.postReviewFindings("acme/widgets", 42, findings, "approved");

      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        1,
        "acme/widgets",
        42,
        expect.stringContaining("[BLOCKER]"),
        "src/a.ts",
        10,
      );
      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        2,
        "acme/widgets",
        42,
        expect.stringContaining("[NIT]"),
        "src/b.ts",
        undefined,
      );
      expect(commentMap).toEqual(
        new Map([
          ["f1", 501],
          ["f2", 502],
        ]),
      );
    });

    it("omits findings from the map when createPRReviewComment returns a falsy id", async () => {
      const findings = [makeFinding({ id: "f1" })];
      githubClient.createPRReviewComment.mockResolvedValue(0);

      const commentMap = await service.postReviewFindings("acme/widgets", 42, findings, "approved");

      expect(commentMap.size).toBe(0);
    });

    it("submits an APPROVE review when the verdict is approved", async () => {
      await service.postReviewFindings("acme/widgets", 42, [], "approved");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        expect.stringContaining("Approved"),
        "APPROVE",
      );
    });

    it("submits a REQUEST_CHANGES review for any non-approved verdict", async () => {
      await service.postReviewFindings("acme/widgets", 42, [], "changes_requested");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        expect.stringContaining("Changes Requested"),
        "REQUEST_CHANGES",
      );
    });

    it("logs a summary including findings count and mapped comment count", async () => {
      const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2" })];
      githubClient.createPRReviewComment.mockResolvedValueOnce(501).mockResolvedValueOnce(0);

      await service.postReviewFindings("acme/widgets", 42, findings, "approved");

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ findingsCount: 2, mappedComments: 1 }),
        expect.any(String),
      );
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("posts a comment including score, summary, and all check rows", async () => {
      const report = makeExecutionReport();

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
      const [repoArg, prArg, body] = githubClient.commentOnPR.mock.calls[0] as [
        string,
        number,
        string,
      ];
      expect(repoArg).toBe("acme/widgets");
      expect(prArg).toBe(42);
      expect(body).toContain("Score: 95%");
      expect(body).toContain("Implemented the feature.");
      expect(body).toContain(":white_check_mark: **Lint**");
      expect(body).toContain(":white_check_mark: **Typecheck**");
      expect(body).toContain(":white_check_mark: **Tests**");
    });

    it("renders fail and skip icons for non-passing checks", async () => {
      const report = makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "2 errors" },
          typecheck: { status: "skip", details: "not run" },
          tests: { status: "pass", details: "ok" },
        },
      });

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain(":x: **Lint**");
      expect(body).toContain(":heavy_minus_sign: **Typecheck**");
    });

    it("omits the files-changed section when there are no changed files", async () => {
      const report = makeExecutionReport({ filesChanged: [] });

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("Files changed");
    });

    it("lists files inline when at or below the collapse threshold", async () => {
      const report = makeExecutionReport({ filesChanged: ["a.ts", "b.ts", "c.ts"] });

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("### Files changed (3)");
      expect(body).not.toContain("<details>");
      expect(body).toContain("`a.ts`");
    });

    it("collapses the files list into a <details> block above the threshold", async () => {
      const files = Array.from({ length: 9 }, (_, i) => `file${String(i)}.ts`);
      const report = makeExecutionReport({ filesChanged: files });

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
      expect(body).toContain("`file8.ts`");
    });

    it("omits the notes section when there are no notes", async () => {
      const report = makeExecutionReport({ notes: [] });

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("### Notes");
    });

    it("includes a Notes section listing each note when notes are present", async () => {
      const report = makeExecutionReport({ notes: ["Watch out for X", "Y was refactored"] });

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("### Notes");
      expect(body).toContain("- Watch out for X");
      expect(body).toContain("- Y was refactored");
    });

    it("logs the execution version, score, and files-changed count", async () => {
      const report = makeExecutionReport({ executionVersion: 3, score: 0.5 });

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ executionVersion: 3, score: 0.5, filesChanged: 1 }),
        expect.any(String),
      );
    });
  });

  describe("postRemediationResolutions", () => {
    function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
      return {
        findingId: "f1",
        status: "accepted",
        action: "Fixed the null check.",
        rationale: "The finding was valid.",
        ...overrides,
      };
    }

    it("replies to the mapped review comment for each resolved finding", async () => {
      const resolutions = [makeResolution({ findingId: "f1", status: "accepted" })];

      await service.postRemediationResolutions("acme/widgets", 42, resolutions, { f1: 501 });

      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        501,
        expect.stringContaining("accepted"),
      );
    });

    it("does not reply when the finding has no mapped comment id", async () => {
      const resolutions = [makeResolution({ findingId: "f-unmapped" })];

      await service.postRemediationResolutions("acme/widgets", 42, resolutions, {});

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    });

    it("posts a single markdown summary comment covering all resolutions", async () => {
      const resolutions = [
        makeResolution({ findingId: "f1", status: "accepted" }),
        makeResolution({ findingId: "f2", status: "rejected" }),
        makeResolution({ findingId: "f3", status: "partially_addressed" }),
      ];

      await service.postRemediationResolutions("acme/widgets", 42, resolutions, {});

      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("## AI Remediation Summary");
      expect(body).toContain("f1");
      expect(body).toContain("f2");
      expect(body).toContain("f3");
      expect(body).toContain(":white_check_mark:");
      expect(body).toContain(":no_entry_sign:");
      expect(body).toContain(":warning:");
    });

    it("falls back to a grey-question icon for an unrecognized status", async () => {
      const resolutions = [
        makeResolution({
          findingId: "f1",
          status: "mystery_status" as unknown as ResolutionItem["status"],
        }),
      ];

      await service.postRemediationResolutions("acme/widgets", 42, resolutions, { f1: 501 });

      const replyBody = githubClient.replyToReviewComment.mock.calls[0][3] as string;
      expect(replyBody).toContain(":grey_question:");
      const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summaryBody).toContain(":grey_question:");
    });

    it("logs resolution count and how many were replied to", async () => {
      const resolutions = [
        makeResolution({ findingId: "f1" }),
        makeResolution({ findingId: "f2" }),
      ];

      await service.postRemediationResolutions("acme/widgets", 42, resolutions, { f1: 501 });

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ resolutionCount: 2, repliedTo: 1 }),
        expect.any(String),
      );
    });
  });
});
