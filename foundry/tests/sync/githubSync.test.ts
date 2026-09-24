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
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: "Test issue",
    linearIssueTitle: "Test Issue",
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: "ai/run-1",
    prNumber: 42,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
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

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f-1",
    severity: "important",
    type: "bug",
    file: "src/foo.ts",
    lineHint: 12,
    title: "Off by one",
    details: "The loop bound is wrong.",
    ...overrides,
  };
}

function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
  return {
    findingId: "f-1",
    status: "accepted",
    action: "Fixed the loop bound",
    rationale: "Confirmed the off-by-one and corrected it",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts", "src/b.ts"],
    checks: {
      lint: { status: "pass", details: "0 problems" },
      typecheck: { status: "pass", details: "no errors" },
      tests: { status: "pass", details: "12 passed" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "All checks passed",
    ...overrides,
  };
}

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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
    it("does nothing when the run has no prNumber", async () => {
      const run = makeRun({ prNumber: null, state: RunState.ReadyForHumanReview });
      await service.syncState(run);
      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when state is ReadyForHumanReview", async () => {
      const run = makeRun({ prNumber: 42, state: RunState.ReadyForHumanReview });
      await service.syncState(run);

      expect(githubClient.markPRReady).toHaveBeenCalledWith("acme/widgets", 42);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        "All AI checks passed. Ready for human review.",
      );
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "acme/widgets", prNumber: 42 },
        "Marked PR ready for review",
      );
    });

    it.each([
      RunState.Todo,
      RunState.Planning,
      RunState.PlanReview,
      RunState.PlanRevision,
      RunState.AwaitingPlanApproval,
      RunState.Implementing,
      RunState.AIReview,
      RunState.AddressingReview,
      RunState.Done,
      RunState.AIBlocked,
      RunState.HumanClarificationNeeded,
      RunState.Failed,
    ])("does not touch the PR for state %s", async (state) => {
      const run = makeRun({ prNumber: 42, state });
      await service.syncState(run);
      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });
  });

  describe("postReviewFindings", () => {
    it("posts an inline comment per finding and maps returned comment ids", async () => {
      const findings = [
        makeFinding({ id: "f-1", severity: "blocker", file: "src/a.ts", lineHint: 3 }),
        makeFinding({ id: "f-2", severity: "nit", file: "src/b.ts", lineHint: undefined }),
      ];
      githubClient.createPRReviewComment
        .mockResolvedValueOnce(1001)
        .mockResolvedValueOnce(1002);

      const result = await service.postReviewFindings("acme/widgets", 42, findings, "approved");

      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        1,
        "acme/widgets",
        42,
        "**[BLOCKER]** Off by one\n\nThe loop bound is wrong.",
        "src/a.ts",
        3,
      );
      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        2,
        "acme/widgets",
        42,
        "**[NIT]** Off by one\n\nThe loop bound is wrong.",
        "src/b.ts",
        undefined,
      );
      expect(result.get("f-1")).toBe(1001);
      expect(result.get("f-2")).toBe(1002);
    });

    it("does not map a finding whose comment id is falsy", async () => {
      githubClient.createPRReviewComment.mockResolvedValueOnce(0);
      const result = await service.postReviewFindings(
        "acme/widgets",
        42,
        [makeFinding({ id: "f-1" })],
        "approved",
      );
      expect(result.has("f-1")).toBe(false);
    });

    it("submits an APPROVE review for an approved verdict", async () => {
      await service.postReviewFindings("acme/widgets", 42, [], "approved");
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        expect.stringContaining("AI Code Review: Approved"),
        "APPROVE",
      );
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        expect.stringContaining("0 finding(s) posted as inline comments."),
        "APPROVE",
      );
    });

    it("submits a REQUEST_CHANGES review for a non-approved verdict", async () => {
      const findings = [makeFinding()];
      githubClient.createPRReviewComment.mockResolvedValueOnce(1001);
      await service.postReviewFindings("acme/widgets", 42, findings, "changes_requested");
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        expect.stringContaining("AI Code Review: Changes Requested"),
        "REQUEST_CHANGES",
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: "acme/widgets",
          prNumber: 42,
          findingsCount: 1,
          verdict: "changes_requested",
          mappedComments: 1,
        }),
        "Posted review findings as PR review comments",
      );
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("renders the score, checks, and a collapsible files section when files exceed the threshold", async () => {
      const report = makeExecutionReport({
        executionVersion: 2,
        score: 0.755,
        filesChanged: Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`),
        checks: {
          lint: { status: "pass", details: "clean" },
          typecheck: { status: "fail", details: "2 errors" },
          tests: { status: "skip", details: "not run" },
        },
        notes: ["Consider adding more tests"],
      });

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
      const [repoArg, prArg, body] = githubClient.commentOnPR.mock.calls[0] as [
        string,
        number,
        string,
      ];
      expect(repoArg).toBe("acme/widgets");
      expect(prArg).toBe(42);
      expect(body).toContain("## AI Execution Report (v2) -- Score: 76%");
      expect(body).toContain(":white_check_mark: **Lint** -- clean");
      expect(body).toContain(":x: **Typecheck** -- 2 errors");
      expect(body).toContain(":heavy_minus_sign: **Tests** -- not run");
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
      expect(body).toContain("### Notes");
      expect(body).toContain("- Consider adding more tests");

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: "acme/widgets",
          prNumber: 42,
          executionVersion: 2,
          score: 0.755,
          filesChanged: 9,
        }),
        "Posted execution report update to PR",
      );
    });

    it("renders an uncollapsed files list at or below the threshold and omits empty sections", async () => {
      const report = makeExecutionReport({
        filesChanged: ["src/a.ts"],
        notes: [],
      });

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("### Files changed (1)");
      expect(body).not.toContain("<details>");
      expect(body).not.toContain("### Notes");
    });

    it("omits the files section entirely when no files changed", async () => {
      const report = makeExecutionReport({ filesChanged: [] });
      await service.postExecutionReportUpdate("acme/widgets", 42, report);
      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("Files changed");
    });
  });

  describe("postRemediationResolutions", () => {
    it("replies to each mapped finding with the correct status icon and posts a summary table", async () => {
      const resolutions = [
        makeResolution({ findingId: "f-1", status: "accepted" }),
        makeResolution({ findingId: "f-2", status: "rejected" }),
        makeResolution({ findingId: "f-3", status: "partially_addressed" }),
      ];
      const commentMap = { "f-1": 1001, "f-2": 1002, "f-3": 1003 };

      await service.postRemediationResolutions("acme/widgets", 42, resolutions, commentMap);

      expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(3);
      expect(githubClient.replyToReviewComment).toHaveBeenNthCalledWith(
        1,
        "acme/widgets",
        42,
        1001,
        expect.stringContaining(":white_check_mark: **accepted**"),
      );
      expect(githubClient.replyToReviewComment).toHaveBeenNthCalledWith(
        2,
        "acme/widgets",
        42,
        1002,
        expect.stringContaining(":no_entry_sign: **rejected**"),
      );
      expect(githubClient.replyToReviewComment).toHaveBeenNthCalledWith(
        3,
        "acme/widgets",
        42,
        1003,
        expect.stringContaining(":warning: **partially addressed**"),
      );

      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        expect.stringContaining("## AI Remediation Summary"),
      );
      const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summaryBody).toContain("| :white_check_mark: **f-1** | accepted |");
      expect(summaryBody).toContain("| :no_entry_sign: **f-2** | rejected |");
      expect(summaryBody).toContain("| :warning: **f-3** | partially addressed |");

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: "acme/widgets",
          prNumber: 42,
          resolutionCount: 3,
          repliedTo: 3,
        }),
        "Posted remediation resolutions to PR",
      );
    });

    it("skips replying to resolutions with no mapped GitHub comment id", async () => {
      const resolutions = [makeResolution({ findingId: "f-unmapped" })];
      await service.postRemediationResolutions("acme/widgets", 42, resolutions, {});
      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
    });

    it("falls back to a question mark icon for an unrecognised status", async () => {
      const resolutions = [
        { findingId: "f-1", status: "mystery" as never, action: "did something", rationale: "why" },
      ];
      await service.postRemediationResolutions("acme/widgets", 42, resolutions, { "f-1": 1001 });
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        1001,
        expect.stringContaining(":grey_question:"),
      );
      const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summaryBody).toContain(":grey_question: **f-1**");
    });
  });
});
