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
    repo: "owner/repo",
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
    file: "src/a.ts",
    lineHint: 10,
    title: "Possible null deref",
    details: "This value may be null here.",
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
    score: 0.9,
    scoreRationale: "All checks passed.",
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
      const run = makeRun({ prNumber: null, state: RunState.ReadyForHumanReview });

      await service.syncState(run);

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("does nothing when state is not ReadyForHumanReview, even with a PR number", async () => {
      const run = makeRun({ prNumber: 42, state: RunState.Implementing });

      await service.syncState(run);

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when state is ReadyForHumanReview", async () => {
      const run = makeRun({ prNumber: 42, repo: "owner/repo", state: RunState.ReadyForHumanReview });

      await service.syncState(run);

      expect(githubClient.markPRReady).toHaveBeenCalledWith("owner/repo", 42);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "owner/repo",
        42,
        "All AI checks passed. Ready for human review.",
      );
      expect(logger.debug).toHaveBeenCalledWith(
        { repo: "owner/repo", prNumber: 42 },
        "Marked PR ready for review",
      );
    });
  });

  describe("postReviewFindings", () => {
    it("posts one review comment per finding and submits an APPROVE review on approved verdict", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(501);
      const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2", file: "src/b.ts" })];

      const commentMap = await service.postReviewFindings(
        "owner/repo",
        42,
        findings,
        "approved",
      );

      expect(githubClient.createPRReviewComment).toHaveBeenCalledTimes(2);
      expect(githubClient.createPRReviewComment).toHaveBeenCalledWith(
        "owner/repo",
        42,
        "**[IMPORTANT]** Possible null deref\n\nThis value may be null here.",
        "src/a.ts",
        10,
      );
      expect(commentMap).toEqual(
        new Map([
          ["f1", 501],
          ["f2", 501],
        ]),
      );
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.stringContaining("AI Code Review: Approved"),
        "APPROVE",
      );
    });

    it("submits REQUEST_CHANGES for a non-approved verdict", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(600);

      await service.postReviewFindings("owner/repo", 42, [makeFinding()], "changes_requested");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.stringContaining("AI Code Review: Changes Requested"),
        "REQUEST_CHANGES",
      );
    });

    it("excludes a finding from the comment map when createPRReviewComment returns a falsy id (0)", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(0);

      const commentMap = await service.postReviewFindings(
        "owner/repo",
        42,
        [makeFinding({ id: "f1" })],
        "approved",
      );

      expect(commentMap.size).toBe(0);
    });

    it("handles an empty findings array", async () => {
      const commentMap = await service.postReviewFindings("owner/repo", 42, [], "approved");

      expect(commentMap.size).toBe(0);
      expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "owner/repo",
        42,
        expect.stringContaining("0 finding(s) posted"),
        "APPROVE",
      );
    });

    it("logs the summary info with counts", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(700);

      await service.postReviewFindings("owner/repo", 42, [makeFinding()], "approved");

      expect(logger.info).toHaveBeenCalledWith(
        {
          repo: "owner/repo",
          prNumber: 42,
          findingsCount: 1,
          verdict: "approved",
          mappedComments: 1,
        },
        "Posted review findings as PR review comments",
      );
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("lists files directly (no <details>) when at or under the collapse threshold", async () => {
      const report = makeExecutionReport({ filesChanged: ["a.ts", "b.ts"] });

      await service.postExecutionReportUpdate("owner/repo", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("### Files changed (2)");
      expect(body).not.toContain("<details>");
      expect(body).toContain("- `a.ts`");
    });

    it("wraps files in a <details> block when over the collapse threshold", async () => {
      const files = Array.from({ length: 9 }, (_, i) => `file${String(i)}.ts`);
      const report = makeExecutionReport({ filesChanged: files });

      await service.postExecutionReportUpdate("owner/repo", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
    });

    it("omits the files section entirely when filesChanged is empty", async () => {
      const report = makeExecutionReport({ filesChanged: [] });

      await service.postExecutionReportUpdate("owner/repo", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("Files changed");
    });

    it("includes a Notes section when notes are present and omits it otherwise", async () => {
      const withNotes = makeExecutionReport({ notes: ["Heads up: flaky test skipped"] });
      await service.postExecutionReportUpdate("owner/repo", 42, withNotes);
      const bodyWithNotes = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(bodyWithNotes).toContain("### Notes");
      expect(bodyWithNotes).toContain("Heads up: flaky test skipped");

      githubClient.commentOnPR.mockClear();
      const withoutNotes = makeExecutionReport({ notes: [] });
      await service.postExecutionReportUpdate("owner/repo", 42, withoutNotes);
      const bodyWithoutNotes = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(bodyWithoutNotes).not.toContain("### Notes");
    });

    it("renders pass/fail/other check icons correctly", async () => {
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "fail", details: "type error" },
          tests: { status: "skip", details: "skipped" },
        },
      });

      await service.postExecutionReportUpdate("owner/repo", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain(":white_check_mark: **Lint** -- ok");
      expect(body).toContain(":x: **Typecheck** -- type error");
      expect(body).toContain(":heavy_minus_sign: **Tests** -- skipped");
    });

    it("includes the score percentage, rationale, and summary", async () => {
      const report = makeExecutionReport({
        score: 0.75,
        scoreRationale: "Mostly good.",
        summary: "Did the thing.",
        executionVersion: 3,
      });

      await service.postExecutionReportUpdate("owner/repo", 42, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("AI Execution Report (v3) -- Score: 75%");
      expect(body).toContain("*Mostly good.*");
      expect(body).toContain("Did the thing.");
    });

    it("logs with the right metadata", async () => {
      const report = makeExecutionReport({ executionVersion: 2, score: 0.5 });

      await service.postExecutionReportUpdate("owner/repo", 42, report);

      expect(logger.info).toHaveBeenCalledWith(
        {
          repo: "owner/repo",
          prNumber: 42,
          executionVersion: 2,
          score: 0.5,
          filesChanged: report.filesChanged.length,
        },
        "Posted execution report update to PR",
      );
    });
  });

  describe("postRemediationResolutions", () => {
    function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
      return {
        findingId: "f1",
        status: "accepted",
        action: "Added null check",
        rationale: "Prevents runtime crash.",
        ...overrides,
      };
    }

    it("replies to a review comment when a mapped GitHub comment id exists", async () => {
      const resolutions = [makeResolution({ findingId: "f1", status: "accepted" })];

      await service.postRemediationResolutions("owner/repo", 42, resolutions, { f1: 501 });

      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "owner/repo",
        42,
        501,
        expect.stringContaining(":white_check_mark: **accepted**"),
      );
    });

    it("does not reply when there is no mapped GitHub comment id for the finding", async () => {
      const resolutions = [makeResolution({ findingId: "f-unmapped" })];

      await service.postRemediationResolutions("owner/repo", 42, resolutions, {});

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    });

    it("uses the rejected and partially_addressed icons correctly", async () => {
      const resolutions = [
        makeResolution({ findingId: "f1", status: "rejected" }),
        makeResolution({ findingId: "f2", status: "partially_addressed" }),
      ];

      await service.postRemediationResolutions("owner/repo", 42, resolutions, {
        f1: 1,
        f2: 2,
      });

      expect(githubClient.replyToReviewComment).toHaveBeenNthCalledWith(
        1,
        "owner/repo",
        42,
        1,
        expect.stringContaining(":no_entry_sign: **rejected**"),
      );
      expect(githubClient.replyToReviewComment).toHaveBeenNthCalledWith(
        2,
        "owner/repo",
        42,
        2,
        expect.stringContaining(":warning: **partially addressed**"),
      );
    });

    it("falls back to the unknown-status icon for a status outside the known map", async () => {
      const resolutions = [
        { ...makeResolution({ findingId: "f1" }), status: "mystery" } as unknown as ResolutionItem,
      ];

      await service.postRemediationResolutions("owner/repo", 42, resolutions, { f1: 1 });

      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "owner/repo",
        42,
        1,
        expect.stringContaining(":grey_question:"),
      );
      const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summaryBody).toContain(":grey_question:");
    });

    it("posts a markdown summary table with all resolutions and logs metadata", async () => {
      const resolutions = [
        makeResolution({ findingId: "f1", status: "accepted", action: "Fix A", rationale: "R A" }),
        makeResolution({ findingId: "f2", status: "rejected", action: "Fix B", rationale: "R B" }),
      ];

      await service.postRemediationResolutions("owner/repo", 42, resolutions, { f1: 501 });

      const summaryBody = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summaryBody).toContain("## AI Remediation Summary");
      expect(summaryBody).toContain("| Finding | Status | Action | Rationale |");
      expect(summaryBody).toContain("**f1** | accepted | Fix A | R A |");
      expect(summaryBody).toContain("**f2** | rejected | Fix B | R B |");

      expect(logger.info).toHaveBeenCalledWith(
        {
          repo: "owner/repo",
          prNumber: 42,
          resolutionCount: 2,
          repliedTo: 1,
        },
        "Posted remediation resolutions to PR",
      );
    });
  });
});
