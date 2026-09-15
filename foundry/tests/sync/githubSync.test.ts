import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Finding } from "../../src/schemas/review.js";
import type { ResolutionItem } from "../../src/schemas/remediation.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { GitHubClient } from "../../src/github/githubClient.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

function makeGithubClient(): GitHubClient {
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
  } as unknown as GitHubClient;
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/lin-1",
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
    title: "Bug found",
    details: "Something is wrong",
    ...overrides,
  };
}

function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
  return {
    findingId: "f1",
    status: "accepted",
    action: "Fixed it",
    rationale: "Made sense",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts", "src/b.ts"],
    checks: {
      lint: { status: "pass", details: "no issues" },
      typecheck: { status: "fail", details: "1 error" },
      tests: { status: "skip", details: "not run" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.85,
    scoreRationale: "Mostly complete",
    ...overrides,
  };
}

describe("GitHubSyncService", () => {
  let githubClient: GitHubClient;
  let logger: Logger;
  let service: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGithubClient();
    logger = makeLogger();
    service = new GitHubSyncService(githubClient, logger);
  });

  describe("syncState", () => {
    it("is a no-op when run.prNumber is falsy", async () => {
      const run = makeRun({ prNumber: null, state: RunState.ReadyForHumanReview });
      await service.syncState(run);
      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("marks PR ready and comments when state is ReadyForHumanReview", async () => {
      const run = makeRun({ prNumber: 7, state: RunState.ReadyForHumanReview, repo: "acme/repo" });
      await service.syncState(run);
      expect(githubClient.markPRReady).toHaveBeenCalledWith("acme/repo", 7);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "acme/repo",
        7,
        "All AI checks passed. Ready for human review.",
      );
    });

    it("is a no-op for other states", async () => {
      const run = makeRun({ prNumber: 7, state: RunState.Implementing });
      await service.syncState(run);
      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });
  });

  describe("postReviewFindings", () => {
    it("builds a commentMap only for findings whose createPRReviewComment returns a truthy id", async () => {
      const findingWithId = makeFinding({ id: "f1" });
      const findingWithZeroId = makeFinding({ id: "f2" });
      (githubClient.createPRReviewComment as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(555)
        .mockResolvedValueOnce(0);

      const commentMap = await service.postReviewFindings(
        "acme/repo",
        10,
        [findingWithId, findingWithZeroId],
        "changes_requested",
      );

      expect(commentMap.get("f1")).toBe(555);
      expect(commentMap.has("f2")).toBe(false);
      expect(commentMap.size).toBe(1);
    });

    it("submits APPROVE review when verdict is approved", async () => {
      (githubClient.createPRReviewComment as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      const finding = makeFinding();

      await service.postReviewFindings("acme/repo", 10, [finding], "approved");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/repo",
        10,
        "AI Code Review: Approved\n\n1 finding(s) posted as inline comments.",
        "APPROVE",
      );
    });

    it("submits REQUEST_CHANGES review for any non-approved verdict", async () => {
      (githubClient.createPRReviewComment as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      const finding = makeFinding();

      await service.postReviewFindings("acme/repo", 10, [finding], "changes_requested");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/repo",
        10,
        "AI Code Review: Changes Requested\n\n1 finding(s) posted as inline comments.",
        "REQUEST_CHANGES",
      );
    });

    it("posts each finding as an inline review comment with severity and details", async () => {
      (githubClient.createPRReviewComment as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      const finding = makeFinding({
        severity: "important",
        title: "Missing null check",
        details: "This could throw",
        file: "src/x.ts",
        lineHint: 12,
      });

      await service.postReviewFindings("acme/repo", 10, [finding], "changes_requested");

      expect(githubClient.createPRReviewComment).toHaveBeenCalledWith(
        "acme/repo",
        10,
        "**[IMPORTANT]** Missing null check\n\nThis could throw",
        "src/x.ts",
        12,
      );
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("uses the inline file-list branch when filesChanged.length <= 8", async () => {
      const report = makeExecutionReport({ filesChanged: ["a.ts", "b.ts"], notes: [] });

      await service.postExecutionReportUpdate("acme/repo", 5, report);

      const body = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
      expect(body).toContain("### Files changed (2)");
      expect(body).toContain("- `a.ts`");
      expect(body).toContain("- `b.ts`");
      expect(body).not.toContain("<details>");
    });

    it("uses the <details> collapse branch when filesChanged.length > 8", async () => {
      const files = Array.from({ length: 9 }, (_, i) => `file${String(i)}.ts`);
      const report = makeExecutionReport({ filesChanged: files });

      await service.postExecutionReportUpdate("acme/repo", 5, report);

      const body = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("<summary><strong>Files changed (9)</strong></summary>");
      expect(body).toContain("- `file0.ts`");
      expect(body).toContain("</details>");
    });

    it("includes a Notes section when notes are present", async () => {
      const report = makeExecutionReport({ notes: ["Watch out for X", "Also Y"] });

      await service.postExecutionReportUpdate("acme/repo", 5, report);

      const body = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
      expect(body).toContain("### Notes");
      expect(body).toContain("- Watch out for X");
      expect(body).toContain("- Also Y");
    });

    it("omits the Notes section when notes are empty", async () => {
      const report = makeExecutionReport({ notes: [] });

      await service.postExecutionReportUpdate("acme/repo", 5, report);

      const body = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
      expect(body).not.toContain("### Notes");
    });

    it("includes the score percentage and check rows in the body", async () => {
      const report = makeExecutionReport({ score: 0.5 });

      await service.postExecutionReportUpdate("acme/repo", 5, report);

      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "acme/repo",
        5,
        expect.stringContaining("Score: 50%"),
      );
      const body = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
      expect(body).toContain(":white_check_mark: **Lint** -- no issues");
      expect(body).toContain(":x: **Typecheck** -- 1 error");
      expect(body).toContain(":heavy_minus_sign: **Tests** -- not run");
    });
  });

  describe("postRemediationResolutions", () => {
    it("replies to the review comment when a commentMap entry is present", async () => {
      const resolution = makeResolution({ findingId: "f1", status: "accepted" });
      const commentMap = { f1: 999 };

      await service.postRemediationResolutions("acme/repo", 3, [resolution], commentMap);

      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "acme/repo",
        3,
        999,
        expect.stringContaining("**Action:** Fixed it"),
      );
    });

    it("does not reply for a resolution whose findingId has no commentMap entry", async () => {
      const resolution = makeResolution({ findingId: "unmapped" });

      await service.postRemediationResolutions("acme/repo", 3, [resolution], {});

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    });

    it("posts a final summary table via commentOnPR", async () => {
      const resolution = makeResolution({
        findingId: "f1",
        status: "partially_addressed",
        action: "Partially fixed",
        rationale: "Ran out of time",
      });

      await service.postRemediationResolutions("acme/repo", 3, [resolution], {});

      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "acme/repo",
        3,
        expect.stringContaining("## AI Remediation Summary"),
      );
      const summaryBody = (githubClient.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
      expect(summaryBody).toContain("| :warning: **f1** | partially addressed | Partially fixed | Ran out of time |");
    });
  });
});
