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
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/repo",
    branchName: "ai/lin-1",
    prNumber: 42,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

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

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "important",
    type: "bug",
    file: "src/a.ts",
    lineHint: 10,
    title: "Possible null deref",
    details: "This may throw if x is null.",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "No issues" },
      typecheck: { status: "pass", details: "No issues" },
      tests: { status: "pass", details: "42 passed" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.95,
    scoreRationale: "All checks passed",
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
    it("does nothing when the run has no prNumber", async () => {
      await service.syncState(makeRun({ prNumber: null, state: RunState.ReadyForHumanReview }));

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("does nothing for states other than ReadyForHumanReview", async () => {
      await service.syncState(makeRun({ state: RunState.Implementing }));

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when the run reaches ReadyForHumanReview", async () => {
      const run = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7, repo: "acme/repo" });

      await service.syncState(run);

      expect(githubClient.markPRReady).toHaveBeenCalledWith("acme/repo", 7);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "acme/repo",
        7,
        "All AI checks passed. Ready for human review.",
      );
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe("postReviewFindings", () => {
    it("posts one review comment per finding and maps finding id to comment id", async () => {
      githubClient.createPRReviewComment
        .mockResolvedValueOnce(101)
        .mockResolvedValueOnce(102);

      const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2" })];
      const commentMap = await service.postReviewFindings("acme/repo", 7, findings, "approved");

      expect(commentMap.get("f1")).toBe(101);
      expect(commentMap.get("f2")).toBe(102);
      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        1,
        "acme/repo",
        7,
        "**[IMPORTANT]** Possible null deref\n\nThis may throw if x is null.",
        "src/a.ts",
        10,
      );
    });

    it("does not add a finding to the comment map when createPRReviewComment returns 0", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(0);

      const commentMap = await service.postReviewFindings(
        "acme/repo",
        7,
        [makeFinding({ id: "f1" })],
        "approved",
      );

      expect(commentMap.has("f1")).toBe(false);
    });

    it("submits an APPROVE review when the verdict is approved", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(1);

      await service.postReviewFindings("acme/repo", 7, [makeFinding()], "approved");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/repo",
        7,
        expect.stringContaining("Approved"),
        "APPROVE",
      );
    });

    it("submits a REQUEST_CHANGES review for any other verdict", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(1);

      await service.postReviewFindings("acme/repo", 7, [makeFinding()], "changes_requested");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/repo",
        7,
        expect.stringContaining("Changes Requested"),
        "REQUEST_CHANGES",
      );
    });

    it("handles an empty findings list", async () => {
      const commentMap = await service.postReviewFindings("acme/repo", 7, [], "approved");

      expect(commentMap.size).toBe(0);
      expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
      expect(githubClient.submitPRReview).toHaveBeenCalled();
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("renders check icons for pass, fail, and skip statuses", async () => {
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "clean" },
          typecheck: { status: "fail", details: "2 errors" },
          tests: { status: "skip", details: "not run" },
        },
      });

      await service.postExecutionReportUpdate("acme/repo", 7, report);

      const body = githubClient.commentOnPR.mock.calls[0]?.[2] as string;
      expect(body).toContain(":white_check_mark: **Lint**");
      expect(body).toContain(":x: **Typecheck**");
      expect(body).toContain(":heavy_minus_sign: **Tests**");
    });

    it("lists files inline when at or under the collapse threshold", async () => {
      const report = makeExecutionReport({ filesChanged: ["a.ts", "b.ts"] });

      await service.postExecutionReportUpdate("acme/repo", 7, report);

      const body = githubClient.commentOnPR.mock.calls[0]?.[2] as string;
      expect(body).toContain("### Files changed (2)");
      expect(body).not.toContain("<details>");
    });

    it("collapses the file list behind <details> when over the threshold", async () => {
      const files = Array.from({ length: 9 }, (_, i) => `file${String(i)}.ts`);
      const report = makeExecutionReport({ filesChanged: files });

      await service.postExecutionReportUpdate("acme/repo", 7, report);

      const body = githubClient.commentOnPR.mock.calls[0]?.[2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
    });

    it("omits the files section entirely when filesChanged is empty", async () => {
      const report = makeExecutionReport({ filesChanged: [] });

      await service.postExecutionReportUpdate("acme/repo", 7, report);

      const body = githubClient.commentOnPR.mock.calls[0]?.[2] as string;
      expect(body).not.toContain("Files changed");
    });

    it("includes a Notes section only when notes are present", async () => {
      const withNotes = makeExecutionReport({ notes: ["Watch out for X"] });
      await service.postExecutionReportUpdate("acme/repo", 7, withNotes);
      const bodyWithNotes = githubClient.commentOnPR.mock.calls[0]?.[2] as string;
      expect(bodyWithNotes).toContain("### Notes");
      expect(bodyWithNotes).toContain("Watch out for X");

      githubClient.commentOnPR.mockClear();
      const withoutNotes = makeExecutionReport({ notes: [] });
      await service.postExecutionReportUpdate("acme/repo", 7, withoutNotes);
      const bodyWithoutNotes = githubClient.commentOnPR.mock.calls[0]?.[2] as string;
      expect(bodyWithoutNotes).not.toContain("### Notes");
    });

    it("renders the score as a rounded percentage and logs info", async () => {
      const report = makeExecutionReport({ score: 0.876 });

      await service.postExecutionReportUpdate("acme/repo", 7, report);

      const body = githubClient.commentOnPR.mock.calls[0]?.[2] as string;
      expect(body).toContain("Score: 88%");
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe("postRemediationResolutions", () => {
    function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
      return {
        findingId: "f1",
        status: "accepted",
        action: "Added a null check",
        rationale: "Prevents the crash",
        ...overrides,
      };
    }

    it("replies to the mapped GitHub comment for each resolution with a known comment id", async () => {
      const resolutions = [makeResolution({ findingId: "f1" })];

      await service.postRemediationResolutions("acme/repo", 7, resolutions, { f1: 101 });

      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "acme/repo",
        7,
        101,
        expect.stringContaining("accepted"),
      );
    });

    it("skips replying when the resolution's finding has no mapped comment id", async () => {
      const resolutions = [makeResolution({ findingId: "unmapped" })];

      await service.postRemediationResolutions("acme/repo", 7, resolutions, {});

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    });

    it("falls back to a question-mark icon for an unrecognized status", async () => {
      const resolutions = [
        makeResolution({ findingId: "f1", status: "weird-status" as never }),
      ];

      await service.postRemediationResolutions("acme/repo", 7, resolutions, { f1: 101 });

      const replyBody = githubClient.replyToReviewComment.mock.calls[0]?.[3] as string;
      expect(replyBody).toContain(":grey_question:");

      const summaryBody = githubClient.commentOnPR.mock.calls[0]?.[2] as string;
      expect(summaryBody).toContain(":grey_question:");
    });

    it("posts a single summary comment covering all resolutions", async () => {
      const resolutions = [
        makeResolution({ findingId: "f1", status: "accepted" }),
        makeResolution({ findingId: "f2", status: "rejected" }),
      ];

      await service.postRemediationResolutions("acme/repo", 7, resolutions, { f1: 101 });

      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
      const summaryBody = githubClient.commentOnPR.mock.calls[0]?.[2] as string;
      expect(summaryBody).toContain("## AI Remediation Summary");
      expect(summaryBody).toContain("f1");
      expect(summaryBody).toContain("f2");
      expect(logger.info).toHaveBeenCalled();
    });
  });
});
