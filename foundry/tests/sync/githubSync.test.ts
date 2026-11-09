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
    linearIssueId: "lin-1",
    linearIssueIdentifier: "PRY-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: "ai/pry-1",
    prNumber: 10,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
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
    title: "Missing check",
    details: "The function does not validate input.",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "pass", details: "all green" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Solid implementation.",
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

    it("marks the PR ready and comments when the run reaches ReadyForHumanReview", async () => {
      await service.syncState(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 10 }));

      expect(githubClient.markPRReady).toHaveBeenCalledWith("acme/widgets", 10);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "acme/widgets",
        10,
        "All AI checks passed. Ready for human review.",
      );
    });

    it("does not mark the PR ready for a non-ReadyForHumanReview state", async () => {
      await service.syncState(makeRun({ state: RunState.Implementing, prNumber: 10 }));
      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });
  });

  describe("postReviewFindings", () => {
    it("posts each finding as a review comment and maps non-zero comment ids", async () => {
      githubClient.createPRReviewComment
        .mockResolvedValueOnce(501)
        .mockResolvedValueOnce(0); // second finding couldn't be posted (file not in diff)

      const findings = [
        makeFinding({ id: "f1", severity: "blocker", title: "Bug" }),
        makeFinding({ id: "f2", severity: "nit", title: "Style", lineHint: 12 }),
      ];

      const commentMap = await service.postReviewFindings("acme/widgets", 10, findings, "changes_requested");

      expect(commentMap.get("f1")).toBe(501);
      expect(commentMap.has("f2")).toBe(false);
      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        1,
        "acme/widgets",
        10,
        "**[BLOCKER]** Bug\n\nThe function does not validate input.",
        "src/a.ts",
        undefined,
      );
      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        2,
        "acme/widgets",
        10,
        "**[NIT]** Style\n\nThe function does not validate input.",
        "src/a.ts",
        12,
      );
    });

    it("submits an APPROVE review when the verdict is approved", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(1);
      await service.postReviewFindings("acme/widgets", 10, [makeFinding()], "approved");
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        10,
        expect.stringContaining("Approved"),
        "APPROVE",
      );
    });

    it("submits a REQUEST_CHANGES review for any non-approved verdict", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(1);
      await service.postReviewFindings("acme/widgets", 10, [makeFinding()], "changes_requested");
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        10,
        expect.stringContaining("Changes Requested"),
        "REQUEST_CHANGES",
      );
    });

    it("handles an empty findings list", async () => {
      const commentMap = await service.postReviewFindings("acme/widgets", 10, [], "approved");
      expect(commentMap.size).toBe(0);
      expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        10,
        expect.stringContaining("0 finding(s)"),
        "APPROVE",
      );
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("renders a short file list when there are 8 or fewer files changed", async () => {
      const report = makeExecutionReport({ filesChanged: ["a.ts", "b.ts"] });
      await service.postExecutionReportUpdate("acme/widgets", 10, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("### Files changed (2)");
      expect(body).toContain("- `a.ts`");
      expect(body).not.toContain("<details>");
    });

    it("collapses the file list into a <details> block when there are more than 8 files", async () => {
      const files = Array.from({ length: 9 }, (_, i) => `file${String(i)}.ts`);
      const report = makeExecutionReport({ filesChanged: files });
      await service.postExecutionReportUpdate("acme/widgets", 10, report);

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
    });

    it("omits the files section entirely when no files changed", async () => {
      const report = makeExecutionReport({ filesChanged: [] });
      await service.postExecutionReportUpdate("acme/widgets", 10, report);
      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("Files changed");
    });

    it("renders a Notes section only when notes are present", async () => {
      const report = makeExecutionReport({ notes: ["Added a helper function"] });
      await service.postExecutionReportUpdate("acme/widgets", 10, report);
      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("### Notes");
      expect(body).toContain("- Added a helper function");
    });

    it("maps each check status to the correct icon", async () => {
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "fail", details: "2 errors" },
          tests: { status: "skip", details: "skipped" },
        },
      });
      await service.postExecutionReportUpdate("acme/widgets", 10, report);
      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain(":white_check_mark: **Lint** -- ok");
      expect(body).toContain(":x: **Typecheck** -- 2 errors");
      expect(body).toContain(":heavy_minus_sign: **Tests** -- skipped");
    });

    it("includes the score percentage and execution version in the header", async () => {
      const report = makeExecutionReport({ executionVersion: 3, score: 0.857 });
      await service.postExecutionReportUpdate("acme/widgets", 10, report);
      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("## AI Execution Report (v3) -- Score: 86%");
      expect(githubClient.commentOnPR).toHaveBeenCalledWith("acme/widgets", 10, expect.any(String));
    });
  });

  describe("postRemediationResolutions", () => {
    function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
      return {
        findingId: "f1",
        status: "accepted",
        action: "Fixed the bug",
        rationale: "It was a real issue",
        ...overrides,
      };
    }

    it("replies only to findings present in the comment map", async () => {
      const resolutions = [
        makeResolution({ findingId: "f1", status: "accepted" }),
        makeResolution({ findingId: "f2", status: "rejected" }),
      ];
      const commentMap = { f1: 501 };

      await service.postRemediationResolutions("acme/widgets", 10, resolutions, commentMap);

      expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(1);
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "acme/widgets",
        10,
        501,
        expect.stringContaining(":white_check_mark: **accepted**"),
      );
    });

    it("uses the correct status icon for each known status and a fallback for unknown ones", async () => {
      const resolutions = [
        makeResolution({ findingId: "f1", status: "accepted" }),
        makeResolution({ findingId: "f2", status: "rejected" }),
        makeResolution({ findingId: "f3", status: "partially_addressed" }),
        // Cast lets us exercise the `?? ":grey_question:"` fallback for a
        // status value outside the known ResolutionStatus union.
        makeResolution({
          findingId: "f4",
          status: "unknown_status" as ResolutionItem["status"],
        }),
      ];
      const commentMap = { f4: 900 };

      await service.postRemediationResolutions("acme/widgets", 10, resolutions, commentMap);

      const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain(":white_check_mark: **f1**");
      expect(summary).toContain(":no_entry_sign: **f2**");
      expect(summary).toContain(":warning: **f3**");
      expect(summary).toContain(":grey_question: **f4**");

      // The fallback icon is also used in the per-comment reply body.
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "acme/widgets",
        10,
        900,
        expect.stringContaining(":grey_question: **unknown status**"),
      );
    });

    it("builds a markdown summary table with one row per resolution", async () => {
      const resolutions = [makeResolution({ findingId: "f1" })];
      await service.postRemediationResolutions("acme/widgets", 10, resolutions, {});

      const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain("## AI Remediation Summary");
      expect(summary).toContain("| Finding | Status | Action | Rationale |");
      expect(summary).toContain("| :white_check_mark: **f1** | accepted | Fixed the bug | It was a real issue |");
    });
  });
});
