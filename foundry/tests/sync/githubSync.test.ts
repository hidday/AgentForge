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
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/repo",
    branchName: "ai/feature",
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

describe("GitHubSyncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("syncState", () => {
    it("does nothing when the run has no PR number", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.syncState(makeRun({ prNumber: null, state: RunState.ReadyForHumanReview }));

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when the run reaches ReadyForHumanReview", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.syncState(makeRun({ state: RunState.ReadyForHumanReview }));

      expect(githubClient.markPRReady).toHaveBeenCalledWith("acme/repo", 42);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "acme/repo",
        42,
        expect.stringContaining("Ready for human review"),
      );
    });

    it("does not touch the PR for other states", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.syncState(makeRun({ state: RunState.Implementing }));

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });
  });

  describe("postReviewFindings", () => {
    function makeFinding(overrides: Partial<Finding> = {}): Finding {
      return {
        id: "f1",
        severity: "blocker",
        type: "bug",
        file: "src/x.ts",
        title: "Null deref",
        details: "Possible null dereference",
        ...overrides,
      };
    }

    it("posts an inline comment per finding and submits REQUEST_CHANGES for a non-approved verdict", async () => {
      const githubClient = makeGithubClient();
      githubClient.createPRReviewComment.mockResolvedValue(1001);
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      const map = await svc.postReviewFindings(
        "acme/repo",
        42,
        [makeFinding(), makeFinding({ id: "f2", lineHint: 10 })],
        "changes_requested",
      );

      expect(githubClient.createPRReviewComment).toHaveBeenCalledTimes(2);
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/repo",
        42,
        expect.stringContaining("Changes Requested"),
        "REQUEST_CHANGES",
      );
      expect(map.get("f1")).toBe(1001);
      expect(map.get("f2")).toBe(1001);
    });

    it("submits APPROVE for an approved verdict and skips findings whose comment id is falsy", async () => {
      const githubClient = makeGithubClient();
      githubClient.createPRReviewComment.mockResolvedValue(0);
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      const map = await svc.postReviewFindings("acme/repo", 42, [makeFinding()], "approved");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "acme/repo",
        42,
        expect.stringContaining("Approved"),
        "APPROVE",
      );
      expect(map.size).toBe(0);
    });

    it("returns an empty map and still submits a review for zero findings", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      const map = await svc.postReviewFindings("acme/repo", 42, [], "approved");

      expect(map.size).toBe(0);
      expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
      expect(githubClient.submitPRReview).toHaveBeenCalled();
    });
  });

  describe("postExecutionReportUpdate", () => {
    function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
      return {
        executionVersion: 1,
        summary: "Implemented the feature",
        filesChanged: ["src/a.ts", "src/b.ts"],
        checks: {
          lint: { status: "pass", details: "clean" },
          typecheck: { status: "pass", details: "clean" },
          tests: { status: "fail", details: "1 failing" },
        },
        notes: ["Edge case handled"],
        prDraftCreated: true,
        score: 0.75,
        scoreRationale: "Mostly solid",
        ...overrides,
      };
    }

    it("renders a comment with score, check icons, and a flat files list under the collapse threshold", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.postExecutionReportUpdate("acme/repo", 42, makeReport());

      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("Score: 75%");
      expect(body).toContain(":white_check_mark: **Lint**");
      expect(body).toContain(":x: **Tests**");
      expect(body).toContain("### Files changed (2)");
      expect(body).not.toContain("<details>");
    });

    it("collapses the files list into a <details> block when above the threshold", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);
      const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i.toString()}.ts`);

      await svc.postExecutionReportUpdate("acme/repo", 42, makeReport({ filesChanged: manyFiles }));

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
    });

    it("omits the files and notes sections entirely when both are empty", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.postExecutionReportUpdate(
        "acme/repo",
        42,
        makeReport({ filesChanged: [], notes: [] }),
      );

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("Files changed");
      expect(body).not.toContain("### Notes");
    });

    it("renders a skip icon for a skipped check", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.postExecutionReportUpdate(
        "acme/repo",
        42,
        makeReport({ checks: { ...makeReport().checks, typecheck: { status: "skip", details: "n/a" } } }),
      );

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain(":heavy_minus_sign: **Typecheck**");
    });
  });

  describe("postRemediationResolutions", () => {
    function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
      return {
        findingId: "f1",
        status: "accepted",
        action: "Added null check",
        rationale: "Prevents crash",
        ...overrides,
      };
    }

    it("replies to each resolution with a mapped GitHub comment id and posts a summary table", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.postRemediationResolutions(
        "acme/repo",
        42,
        [makeResolution(), makeResolution({ findingId: "f2", status: "rejected" })],
        { f1: 1001, f2: 1002 },
      );

      expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(2);
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "acme/repo",
        42,
        1001,
        expect.stringContaining("accepted"),
      );
      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
      const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain("AI Remediation Summary");
      expect(summary).toContain("f1");
      expect(summary).toContain("f2");
    });

    it("skips replying for a resolution with no mapped GitHub comment id but still includes it in the summary", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.postRemediationResolutions(
        "acme/repo",
        42,
        [makeResolution({ findingId: "f-unmapped" })],
        {},
      );

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
      const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain("f-unmapped");
    });

    it("falls back to a question-mark icon for an unrecognized status", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.postRemediationResolutions(
        "acme/repo",
        42,
        [makeResolution({ status: "partially_addressed" })],
        { f1: 1001 },
      );

      const replyBody = githubClient.replyToReviewComment.mock.calls[0][3] as string;
      expect(replyBody).toContain(":warning:");
    });
  });
});
