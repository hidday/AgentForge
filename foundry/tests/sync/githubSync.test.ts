import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { GitHubClient } from "../../src/github/githubClient.js";
import type { Logger } from "../../src/utils/logger.js";
import type { Finding } from "../../src/schemas/review.js";
import type { ResolutionItem } from "../../src/schemas/remediation.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/issue/LIN-1",
    repo: "org/repo",
    branchName: "ai/lin-1",
    prNumber: 42,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/repo",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeGitHubClient(): { [K in keyof GitHubClient]: ReturnType<typeof vi.fn> } {
  return {
    verifyRepoAccess: vi.fn().mockResolvedValue(undefined),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
    createBranch: vi.fn().mockResolvedValue(undefined),
    createDraftPR: vi.fn().mockResolvedValue(1),
    commentOnPR: vi.fn().mockResolvedValue(undefined),
    getPRDiff: vi.fn().mockResolvedValue(""),
    markPRReady: vi.fn().mockResolvedValue(undefined),
    listPRComments: vi.fn().mockResolvedValue([]),
    createPRReviewComment: vi.fn().mockResolvedValue(0),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
    submitPRReview: vi.fn().mockResolvedValue(undefined),
  };
}

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: () => makeLogger(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "important",
    type: "bug",
    file: "src/foo.ts",
    lineHint: 10,
    title: "Possible null deref",
    details: "foo may be null here",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "pass", details: "42 passed" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "all checks green",
    ...overrides,
  };
}

describe("GitHubSyncService", () => {
  let githubClient: ReturnType<typeof makeGitHubClient>;
  let logger: Logger;
  let service: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGitHubClient();
    logger = makeLogger();
    service = new GitHubSyncService(githubClient as unknown as GitHubClient, logger);
  });

  describe("syncState", () => {
    it("does nothing when the run has no PR number", async () => {
      const run = makeRun({ prNumber: null, state: RunState.ReadyForHumanReview });

      await service.syncState(run);

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("does nothing when the state is not ReadyForHumanReview", async () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 5 });

      await service.syncState(run);

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when state is ReadyForHumanReview", async () => {
      const run = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 5, repo: "org/repo" });

      await service.syncState(run);

      expect(githubClient.markPRReady).toHaveBeenCalledWith("org/repo", 5);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "org/repo",
        5,
        "All AI checks passed. Ready for human review.",
      );
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe("postReviewFindings", () => {
    it("returns an empty map and submits APPROVE for no findings on an approved verdict", async () => {
      const result = await service.postReviewFindings("org/repo", 7, [], "approved");

      expect(result.size).toBe(0);
      expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "org/repo",
        7,
        expect.stringContaining("Approved"),
        "APPROVE",
      );
      expect(logger.info).toHaveBeenCalled();
    });

    it("submits REQUEST_CHANGES for a non-approved verdict", async () => {
      await service.postReviewFindings("org/repo", 7, [makeFinding()], "changes_requested");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "org/repo",
        7,
        expect.stringContaining("Changes Requested"),
        "REQUEST_CHANGES",
      );
    });

    it("maps only findings whose comment id is truthy (skips 0 / falsy ids)", async () => {
      githubClient.createPRReviewComment
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(555);
      const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2" })];

      const result = await service.postReviewFindings("org/repo", 7, findings, "approved");

      expect(result.has("f1")).toBe(false);
      expect(result.get("f2")).toBe(555);
    });

    it("posts one review comment per finding with severity/title/details in the body", async () => {
      const finding = makeFinding({
        severity: "blocker",
        title: "SQL Injection",
        details: "Unescaped input",
        file: "src/db.ts",
        lineHint: 20,
      });

      await service.postReviewFindings("org/repo", 7, [finding], "changes_requested");

      expect(githubClient.createPRReviewComment).toHaveBeenCalledWith(
        "org/repo",
        7,
        expect.stringContaining("**[BLOCKER]** SQL Injection"),
        "src/db.ts",
        20,
      );
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("omits the files-changed section when filesChanged is empty", async () => {
      await service.postExecutionReportUpdate(
        "org/repo",
        7,
        makeExecutionReport({ filesChanged: [] }),
      );

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("Files changed");
    });

    it("lists files inline when at or below the collapse threshold", async () => {
      await service.postExecutionReportUpdate(
        "org/repo",
        7,
        makeExecutionReport({ filesChanged: ["a.ts", "b.ts"] }),
      );

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("### Files changed (2)");
      expect(body).not.toContain("<details>");
    });

    it("collapses files into a <details> block above the threshold", async () => {
      const filesChanged = Array.from({ length: 9 }, (_, i) => `file${String(i)}.ts`);

      await service.postExecutionReportUpdate(
        "org/repo",
        7,
        makeExecutionReport({ filesChanged }),
      );

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
    });

    it("omits the notes section when there are no notes, includes it when present", async () => {
      await service.postExecutionReportUpdate("org/repo", 7, makeExecutionReport({ notes: [] }));
      let body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("### Notes");

      await service.postExecutionReportUpdate(
        "org/repo",
        7,
        makeExecutionReport({ notes: ["watch out for X"] }),
      );
      body = githubClient.commentOnPR.mock.calls[1][2] as string;
      expect(body).toContain("### Notes");
      expect(body).toContain("watch out for X");
    });

    it("renders pass/fail/skip icons for each check", async () => {
      await service.postExecutionReportUpdate(
        "org/repo",
        7,
        makeExecutionReport({
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "fail", details: "2 errors" },
            tests: { status: "skip", details: "n/a" },
          },
        }),
      );

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain(":white_check_mark: **Lint**");
      expect(body).toContain(":x: **Typecheck**");
      expect(body).toContain(":heavy_minus_sign: **Tests**");
    });

    it("includes the score percentage and rationale, and logs info", async () => {
      await service.postExecutionReportUpdate(
        "org/repo",
        7,
        makeExecutionReport({ score: 0.5, scoreRationale: "half the checks pass" }),
      );

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("Score: 50%");
      expect(body).toContain("half the checks pass");
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe("postRemediationResolutions", () => {
    it("replies only to resolutions with a matching comment id in commentMap", async () => {
      const resolutions: ResolutionItem[] = [
        { findingId: "f1", status: "accepted", action: "fixed", rationale: "patched" },
        { findingId: "f2", status: "rejected", action: "no-op", rationale: "not applicable" },
      ];

      await service.postRemediationResolutions("org/repo", 7, resolutions, { f1: 500 });

      expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(1);
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "org/repo",
        7,
        500,
        expect.stringContaining(":white_check_mark: **accepted**"),
      );
    });

    it("still posts the summary comment when commentMap is empty", async () => {
      const resolutions: ResolutionItem[] = [
        { findingId: "f1", status: "partially_addressed", action: "partial fix", rationale: "r" },
      ];

      await service.postRemediationResolutions("org/repo", 7, resolutions, {});

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "org/repo",
        7,
        expect.stringContaining("## AI Remediation Summary"),
      );
    });

    it("renders the correct icon per status in the summary table", async () => {
      const resolutions: ResolutionItem[] = [
        { findingId: "f1", status: "accepted", action: "a", rationale: "r" },
        { findingId: "f2", status: "rejected", action: "a", rationale: "r" },
        { findingId: "f3", status: "partially_addressed", action: "a", rationale: "r" },
      ];

      await service.postRemediationResolutions("org/repo", 7, resolutions, {});

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain(":white_check_mark: **f1**");
      expect(body).toContain(":no_entry_sign: **f2**");
      expect(body).toContain(":warning: **f3**");
    });

    it("falls back to the unknown-status icon for an unrecognized status value", async () => {
      const resolutions = [
        {
          findingId: "f1",
          status: "unexpected_status" as ResolutionItem["status"],
          action: "a",
          rationale: "r",
        },
      ];

      await service.postRemediationResolutions("org/repo", 7, resolutions, { f1: 1 });

      const replyBody = githubClient.replyToReviewComment.mock.calls[0][3] as string;
      expect(replyBody).toContain(":grey_question:");
      const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summaryBody).toContain(":grey_question: **f1**");
    });

    it("logs the resolution count and number replied to", async () => {
      const resolutions: ResolutionItem[] = [
        { findingId: "f1", status: "accepted", action: "a", rationale: "r" },
        { findingId: "f2", status: "accepted", action: "a", rationale: "r" },
      ];

      await service.postRemediationResolutions("org/repo", 7, resolutions, { f1: 100 });

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ resolutionCount: 2, repliedTo: 1 }),
        "Posted remediation resolutions to PR",
      );
    });
  });
});
