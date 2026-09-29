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
    branchName: null,
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
    severity: "blocker",
    type: "bug",
    file: "src/foo.ts",
    lineHint: 10,
    title: "Bad thing",
    details: "It is bad",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Did the thing",
    filesChanged: [],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "pass", details: "clean" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Solid work",
    ...overrides,
  };
}

function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
  return {
    findingId: "f1",
    status: "accepted",
    action: "Fixed it",
    rationale: "Because reasons",
    ...overrides,
  };
}

function buildDeps() {
  const githubClient = {
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
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { githubClient, logger };
}

describe("GitHubSyncService", () => {
  let deps: ReturnType<typeof buildDeps>;
  let svc: GitHubSyncService;

  beforeEach(() => {
    deps = buildDeps();
    svc = new GitHubSyncService(deps.githubClient as never, deps.logger as never);
  });

  describe("syncState", () => {
    it("does nothing when the run has no prNumber", async () => {
      const run = makeRun({ prNumber: null, state: RunState.ReadyForHumanReview });
      await svc.syncState(run);
      expect(deps.githubClient.markPRReady).not.toHaveBeenCalled();
      expect(deps.githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when state is ReadyForHumanReview", async () => {
      const run = makeRun({ prNumber: 7, state: RunState.ReadyForHumanReview, repo: "acme/repo" });
      await svc.syncState(run);
      expect(deps.githubClient.markPRReady).toHaveBeenCalledWith("acme/repo", 7);
      expect(deps.githubClient.commentOnPR).toHaveBeenCalledWith(
        "acme/repo",
        7,
        "All AI checks passed. Ready for human review.",
      );
      expect(deps.logger.debug).toHaveBeenCalledWith(
        { repo: "acme/repo", prNumber: 7 },
        "Marked PR ready for review",
      );
    });

    it("does not mark ready for other states even with a prNumber", async () => {
      const run = makeRun({ prNumber: 7, state: RunState.Implementing });
      await svc.syncState(run);
      expect(deps.githubClient.markPRReady).not.toHaveBeenCalled();
      expect(deps.githubClient.commentOnPR).not.toHaveBeenCalled();
      expect(deps.logger.debug).not.toHaveBeenCalled();
    });
  });

  describe("postReviewFindings", () => {
    it("posts inline comments, maps returned comment ids, and submits an APPROVE review", async () => {
      deps.githubClient.createPRReviewComment.mockResolvedValue(555);
      const findings = [makeFinding({ id: "f1", severity: "important", title: "Title A" })];

      const map = await svc.postReviewFindings("acme/repo", 3, findings, "approved");

      expect(deps.githubClient.createPRReviewComment).toHaveBeenCalledWith(
        "acme/repo",
        3,
        "**[IMPORTANT]** Title A\n\nIt is bad",
        "src/foo.ts",
        10,
      );
      expect(map.get("f1")).toBe(555);
      expect(deps.githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/repo",
        3,
        expect.stringContaining("AI Code Review: Approved"),
        "APPROVE",
      );
      expect(deps.logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: "acme/repo",
          prNumber: 3,
          findingsCount: 1,
          verdict: "approved",
          mappedComments: 1,
        }),
        "Posted review findings as PR review comments",
      );
    });

    it("submits REQUEST_CHANGES for a non-approved verdict", async () => {
      deps.githubClient.createPRReviewComment.mockResolvedValue(1);
      await svc.postReviewFindings("acme/repo", 3, [makeFinding()], "changes_requested");
      expect(deps.githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/repo",
        3,
        expect.stringContaining("AI Code Review: Changes Requested"),
        "REQUEST_CHANGES",
      );
    });

    it("omits findings from the map when createPRReviewComment returns a falsy id", async () => {
      deps.githubClient.createPRReviewComment.mockResolvedValue(0);
      const map = await svc.postReviewFindings("acme/repo", 3, [makeFinding({ id: "f-no-id" })], "approved");
      expect(map.has("f-no-id")).toBe(false);
      expect(map.size).toBe(0);
    });

    it("handles an empty findings list", async () => {
      const map = await svc.postReviewFindings("acme/repo", 3, [], "approved");
      expect(map.size).toBe(0);
      expect(deps.githubClient.createPRReviewComment).not.toHaveBeenCalled();
      expect(deps.githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/repo",
        3,
        expect.stringContaining("0 finding(s) posted"),
        "APPROVE",
      );
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("renders check icons for pass, fail, and non-pass/fail statuses", async () => {
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "fail", details: "broken" },
          tests: { status: "skip", details: "skipped" },
        },
      });
      await svc.postExecutionReportUpdate("acme/repo", 5, report);
      const body = deps.githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain(":white_check_mark: **Lint** -- ok");
      expect(body).toContain(":x: **Typecheck** -- broken");
      expect(body).toContain(":heavy_minus_sign: **Tests** -- skipped");
    });

    it("renders a plain files-changed list at or below the collapse threshold", async () => {
      const files = Array.from({ length: 8 }, (_, i) => `src/file${String(i)}.ts`);
      const report = makeExecutionReport({ filesChanged: files });
      await svc.postExecutionReportUpdate("acme/repo", 5, report);
      const body = deps.githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("### Files changed (8)");
      expect(body).not.toContain("<details>");
      expect(body).toContain("- `src/file0.ts`");
    });

    it("collapses the files-changed list above the threshold", async () => {
      const files = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);
      const report = makeExecutionReport({ filesChanged: files });
      await svc.postExecutionReportUpdate("acme/repo", 5, report);
      const body = deps.githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("<summary><strong>Files changed (9)</strong></summary>");
      expect(body).toContain("</details>");
    });

    it("omits the files-changed section entirely when there are no files", async () => {
      const report = makeExecutionReport({ filesChanged: [] });
      await svc.postExecutionReportUpdate("acme/repo", 5, report);
      const body = deps.githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("Files changed");
    });

    it("includes a notes section only when notes are present", async () => {
      const withNotes = makeExecutionReport({ notes: ["Heads up", "Another note"] });
      await svc.postExecutionReportUpdate("acme/repo", 5, withNotes);
      const bodyWithNotes = deps.githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(bodyWithNotes).toContain("### Notes");
      expect(bodyWithNotes).toContain("- Heads up");
      expect(bodyWithNotes).toContain("- Another note");

      deps.githubClient.commentOnPR.mockClear();
      const withoutNotes = makeExecutionReport({ notes: [] });
      await svc.postExecutionReportUpdate("acme/repo", 5, withoutNotes);
      const bodyWithoutNotes = deps.githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(bodyWithoutNotes).not.toContain("### Notes");
    });

    it("includes the score, rationale and summary, and logs the update", async () => {
      const report = makeExecutionReport({
        executionVersion: 3,
        score: 0.876,
        scoreRationale: "Mostly good",
        summary: "Refactored the thing",
        filesChanged: ["a.ts", "b.ts"],
      });
      await svc.postExecutionReportUpdate("acme/repo", 5, report);
      const body = deps.githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("## AI Execution Report (v3) -- Score: 88%");
      expect(body).toContain("*Mostly good*");
      expect(body).toContain("Refactored the thing");
      expect(deps.logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: "acme/repo",
          prNumber: 5,
          executionVersion: 3,
          score: 0.876,
          filesChanged: 2,
        }),
        "Posted execution report update to PR",
      );
    });
  });

  describe("postRemediationResolutions", () => {
    it("replies to mapped review comments and posts a summary table", async () => {
      const resolutions = [
        makeResolution({ findingId: "f1", status: "accepted", action: "Fixed", rationale: "Because" }),
        makeResolution({ findingId: "f2", status: "rejected", action: "Won't fix", rationale: "Not valid" }),
      ];
      const commentMap = { f1: 100 };

      await svc.postRemediationResolutions("acme/repo", 3, resolutions, commentMap);

      expect(deps.githubClient.replyToReviewComment).toHaveBeenCalledTimes(1);
      expect(deps.githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "acme/repo",
        3,
        100,
        expect.stringContaining(":white_check_mark: **accepted**"),
      );

      const summaryBody = deps.githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summaryBody).toContain("## AI Remediation Summary");
      expect(summaryBody).toContain("| :white_check_mark: **f1** | accepted | Fixed | Because |");
      expect(summaryBody).toContain("| :no_entry_sign: **f2** | rejected | Won't fix | Not valid |");

      expect(deps.logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: "acme/repo",
          prNumber: 3,
          resolutionCount: 2,
          repliedTo: 1,
        }),
        "Posted remediation resolutions to PR",
      );
    });

    it("skips replying when a finding has no mapped GitHub comment id", async () => {
      const resolutions = [makeResolution({ findingId: "unmapped" })];
      await svc.postRemediationResolutions("acme/repo", 3, resolutions, {});
      expect(deps.githubClient.replyToReviewComment).not.toHaveBeenCalled();
      expect(deps.githubClient.commentOnPR).toHaveBeenCalled();
    });

    it("uses the partially_addressed icon and falls back for unknown statuses", async () => {
      const resolutions = [
        makeResolution({ findingId: "f1", status: "partially_addressed" }),
        { findingId: "f2", status: "mystery", action: "a", rationale: "r" } as unknown as ResolutionItem,
      ];
      const commentMap = { f1: 1, f2: 2 };
      await svc.postRemediationResolutions("acme/repo", 3, resolutions, commentMap);

      const replyBodies = deps.githubClient.replyToReviewComment.mock.calls.map((c) => c[3] as string);
      expect(replyBodies[0]).toContain(":warning:");
      expect(replyBodies[1]).toContain(":grey_question:");

      const summaryBody = deps.githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summaryBody).toContain(":grey_question: **f2**");
    });
  });
});
