import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Finding } from "../../src/schemas/review.js";
import type { ResolutionItem } from "../../src/schemas/remediation.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeMockGitHubClient() {
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
    branchName: "feature/x",
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
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "finding-1",
    severity: "important",
    type: "bug",
    file: "src/foo.ts",
    lineHint: 10,
    title: "Possible null deref",
    details: "Check for null before use.",
    ...overrides,
  };
}

function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
  return {
    findingId: "finding-1",
    status: "accepted",
    action: "Added a null check.",
    rationale: "Prevents a crash.",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
    filesChanged: ["src/a.ts", "src/b.ts"],
    checks: {
      lint: { status: "pass", details: "No issues." },
      typecheck: { status: "pass", details: "No issues." },
      tests: { status: "fail", details: "2 failing." },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.75,
    scoreRationale: "Mostly solid, tests failing.",
    ...overrides,
  };
}

describe("GitHubSyncService", () => {
  let githubClient: ReturnType<typeof makeMockGitHubClient>;
  let logger: ReturnType<typeof makeMockLogger>;
  let service: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeMockGitHubClient();
    logger = makeMockLogger();
    service = new GitHubSyncService(githubClient as never, logger as never);
  });

  describe("syncState", () => {
    it("is a no-op when run.prNumber is falsy", async () => {
      const run = makeRun({ prNumber: null, state: RunState.ReadyForHumanReview });

      await service.syncState(run);

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when state is ReadyForHumanReview and prNumber is set", async () => {
      const run = makeRun({ prNumber: 42, state: RunState.ReadyForHumanReview, repo: "acme/widgets" });

      await service.syncState(run);

      expect(githubClient.markPRReady).toHaveBeenCalledWith("acme/widgets", 42);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        "All AI checks passed. Ready for human review.",
      );
      const markOrder = githubClient.markPRReady.mock.invocationCallOrder[0];
      const commentOrder = githubClient.commentOnPR.mock.invocationCallOrder[0];
      expect(markOrder).toBeLessThan(commentOrder);
    });

    it("is a no-op for any other state even when prNumber is set", async () => {
      const run = makeRun({ prNumber: 42, state: RunState.Implementing });

      await service.syncState(run);

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });
  });

  describe("postReviewFindings", () => {
    it("maps finding ids to created comment ids only when the comment id is truthy, and submits APPROVE for an approved verdict", async () => {
      const findingWithComment = makeFinding({ id: "f1" });
      const findingWithoutComment = makeFinding({ id: "f2", lineHint: undefined });
      githubClient.createPRReviewComment
        .mockResolvedValueOnce(900)
        .mockResolvedValueOnce(0);

      const result = await service.postReviewFindings(
        "acme/widgets",
        42,
        [findingWithComment, findingWithoutComment],
        "approved",
      );

      expect(result).toEqual(new Map([["f1", 900]]));
      expect(result.has("f2")).toBe(false);
      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        1,
        "acme/widgets",
        42,
        "**[IMPORTANT]** Possible null deref\n\nCheck for null before use.",
        "src/foo.ts",
        10,
      );
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        expect.stringContaining("AI Code Review: Approved"),
        "APPROVE",
      );
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        expect.stringContaining("2 finding(s) posted as inline comments."),
        "APPROVE",
      );
    });

    it("submits REQUEST_CHANGES for a non-approved verdict", async () => {
      githubClient.createPRReviewComment.mockResolvedValueOnce(901);

      await service.postReviewFindings("acme/widgets", 42, [makeFinding()], "changes_requested");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        expect.stringContaining("AI Code Review: Changes Requested"),
        "REQUEST_CHANGES",
      );
      expect(githubClient.submitPRReview).toHaveBeenCalledTimes(1);
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("omits the files-changed section entirely when filesChanged is empty", async () => {
      const report = makeExecutionReport({ filesChanged: [] });

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
      expect(body).not.toContain("Files changed");
    });

    it("renders a plain list when filesChanged has 8 or fewer entries", async () => {
      const report = makeExecutionReport({ filesChanged: ["a.ts", "b.ts", "c.ts"] });

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
      expect(body).toContain("### Files changed (3)");
      expect(body).toContain("- `a.ts`");
      expect(body).not.toContain("<details>");
    });

    it("wraps the files list in <details> when there are more than 8 entries", async () => {
      const files = Array.from({ length: 9 }, (_, i) => `file${String(i)}.ts`);
      const report = makeExecutionReport({ filesChanged: files });

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
      expect(body).toContain("<details>");
      expect(body).toContain("<summary><strong>Files changed (9)</strong></summary>");
      expect(body).toContain("- `file8.ts`");
      expect(body).toContain("</details>");
    });

    it("omits the notes section when notes is empty", async () => {
      const report = makeExecutionReport({ notes: [] });

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
      expect(body).not.toContain("### Notes");
    });

    it("renders the notes section when notes is non-empty", async () => {
      const report = makeExecutionReport({ notes: ["Watch out for X.", "Follow-up needed for Y."] });

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
      expect(body).toContain("### Notes");
      expect(body).toContain("- Watch out for X.");
      expect(body).toContain("- Follow-up needed for Y.");
    });

    it("renders score, checks, and header information in the body", async () => {
      const report = makeExecutionReport({ score: 0.9, executionVersion: 3 });

      await service.postExecutionReportUpdate("acme/widgets", 42, report);

      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        expect.stringContaining("## AI Execution Report (v3) -- Score: 90%"),
      );
      const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
      expect(body).toContain(":white_check_mark: **Lint**");
      expect(body).toContain(":x: **Tests**");
    });
  });

  describe("postRemediationResolutions", () => {
    it("replies on a resolution whose findingId is in commentMap", async () => {
      const resolution = makeResolution({ findingId: "f1", status: "accepted" });

      await service.postRemediationResolutions("acme/widgets", 42, [resolution], { f1: 900 });

      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        900,
        expect.stringContaining("**Action:** Added a null check."),
      );
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        900,
        expect.stringContaining("**Rationale:** Prevents a crash."),
      );
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "acme/widgets",
        42,
        900,
        expect.stringContaining(":white_check_mark: **accepted**"),
      );
    });

    it("does not reply for a resolution whose findingId is not in commentMap", async () => {
      const resolution = makeResolution({ findingId: "f-missing" });

      await service.postRemediationResolutions("acme/widgets", 42, [resolution], { f1: 900 });

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    });

    it("posts a summary table with a row per resolution, falling back to :grey_question: for unknown status", async () => {
      const resolutions = [
        makeResolution({ findingId: "f1", status: "accepted" }),
        makeResolution({
          findingId: "f2",
          status: "weird_unknown_status" as ResolutionItem["status"],
          action: "Did something",
          rationale: "For reasons",
        }),
      ];

      await service.postRemediationResolutions("acme/widgets", 42, resolutions, { f1: 900 });

      const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
      expect(body).toContain("## AI Remediation Summary");
      expect(body).toContain("| :white_check_mark: **f1** | accepted | Added a null check. | Prevents a crash. |");
      expect(body).toContain("| :grey_question: **f2** | weird unknown_status | Did something | For reasons |");
    });
  });
});
