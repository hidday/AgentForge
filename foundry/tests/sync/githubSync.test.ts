import { describe, it, expect, vi } from "vitest";
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
    branchName: "ai/run-1",
    prNumber: 42,
    state: RunState.ReadyForHumanReview,
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
    severity: "blocker",
    type: "bug",
    file: "src/foo.ts",
    title: "Null deref",
    details: "Possible null dereference",
    ...overrides,
  };
}

function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
  return {
    findingId: "f1",
    status: "accepted",
    action: "Added a null check",
    rationale: "Prevents crash",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts", "src/b.ts"],
    checks: {
      lint: { status: "pass", details: "No issues" },
      typecheck: { status: "pass", details: "No issues" },
      tests: { status: "fail", details: "2 failing" },
    },
    notes: ["Followed existing patterns"],
    prDraftCreated: true,
    score: 0.75,
    scoreRationale: "Minor test failures",
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
  describe("syncState", () => {
    it("does nothing when the run has no prNumber", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.syncState(makeRun({ prNumber: null, state: RunState.ReadyForHumanReview }));

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when state is ReadyForHumanReview", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.syncState(makeRun({ prNumber: 42, state: RunState.ReadyForHumanReview }));

      expect(githubClient.markPRReady).toHaveBeenCalledWith("test-repo", 42);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "test-repo",
        42,
        "All AI checks passed. Ready for human review.",
      );
    });

    it("does nothing for other states even when a prNumber is present", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.syncState(makeRun({ prNumber: 42, state: RunState.Implementing }));

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("propagates an error thrown by markPRReady", async () => {
      const githubClient = makeGithubClient();
      githubClient.markPRReady.mockRejectedValue(new Error("GitHub API down"));
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await expect(
        svc.syncState(makeRun({ prNumber: 42, state: RunState.ReadyForHumanReview })),
      ).rejects.toThrow("GitHub API down");
    });
  });

  describe("postReviewFindings", () => {
    it("posts one review comment per finding and maps finding id to comment id", async () => {
      const githubClient = makeGithubClient();
      githubClient.createPRReviewComment.mockResolvedValueOnce(101).mockResolvedValueOnce(102);
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      const findings = [
        makeFinding({ id: "f1", severity: "blocker", title: "Bug A" }),
        makeFinding({ id: "f2", severity: "nit", title: "Bug B", file: "src/bar.ts", lineHint: 10 }),
      ];

      const map = await svc.postReviewFindings("test-repo", 42, findings, "changes_requested");

      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        1,
        "test-repo",
        42,
        "**[BLOCKER]** Bug A\n\nPossible null dereference",
        "src/foo.ts",
        undefined,
      );
      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        2,
        "test-repo",
        42,
        "**[NIT]** Bug B\n\nPossible null dereference",
        "src/bar.ts",
        10,
      );
      expect(map.get("f1")).toBe(101);
      expect(map.get("f2")).toBe(102);
    });

    it("skips a finding in the map when createPRReviewComment returns a falsy id", async () => {
      const githubClient = makeGithubClient();
      githubClient.createPRReviewComment.mockResolvedValue(0);
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      const map = await svc.postReviewFindings("test-repo", 42, [makeFinding()], "approved");

      expect(map.has("f1")).toBe(false);
    });

    it("submits an APPROVE review when verdict is 'approved'", async () => {
      const githubClient = makeGithubClient();
      githubClient.createPRReviewComment.mockResolvedValue(1);
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.postReviewFindings("test-repo", 42, [makeFinding()], "approved");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "test-repo",
        42,
        expect.stringContaining("AI Code Review: Approved"),
        "APPROVE",
      );
    });

    it("submits a REQUEST_CHANGES review for any non-'approved' verdict", async () => {
      const githubClient = makeGithubClient();
      githubClient.createPRReviewComment.mockResolvedValue(1);
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.postReviewFindings("test-repo", 42, [makeFinding()], "changes_requested");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "test-repo",
        42,
        expect.stringContaining("AI Code Review: Changes Requested"),
        "REQUEST_CHANGES",
      );
    });

    it("handles an empty findings array by submitting a review with zero comments", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      const map = await svc.postReviewFindings("test-repo", 42, [], "approved");

      expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
      expect(map.size).toBe(0);
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "test-repo",
        42,
        expect.stringContaining("0 finding(s) posted"),
        "APPROVE",
      );
    });

    it("propagates an error thrown while creating a review comment", async () => {
      const githubClient = makeGithubClient();
      githubClient.createPRReviewComment.mockRejectedValue(new Error("rate limited"));
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await expect(
        svc.postReviewFindings("test-repo", 42, [makeFinding()], "approved"),
      ).rejects.toThrow("rate limited");
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("posts a comment including score, checks, and a short file list", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.postExecutionReportUpdate("test-repo", 42, makeExecutionReport());

      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("Score: 75%");
      expect(body).toContain(":white_check_mark: **Lint** -- No issues");
      expect(body).toContain(":x: **Tests** -- 2 failing");
      expect(body).toContain("### Files changed (2)");
      expect(body).toContain("- `src/a.ts`");
      expect(body).toContain("### Notes");
      expect(body).toContain("- Followed existing patterns");
    });

    it("renders checks with a skip icon for unrecognized statuses", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.postExecutionReportUpdate(
        "test-repo",
        42,
        makeExecutionReport({
          checks: {
            lint: { status: "skip", details: "Not run" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "pass", details: "ok" },
          },
        }),
      );

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain(":heavy_minus_sign: **Lint** -- Not run");
    });

    it("collapses the file list into a <details> block above the threshold", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      const filesChanged = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);
      await svc.postExecutionReportUpdate(
        "test-repo",
        42,
        makeExecutionReport({ filesChanged }),
      );

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
    });

    it("omits the files section entirely when filesChanged is empty", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.postExecutionReportUpdate(
        "test-repo",
        42,
        makeExecutionReport({ filesChanged: [] }),
      );

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("Files changed");
    });

    it("omits the notes section entirely when notes is empty", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.postExecutionReportUpdate("test-repo", 42, makeExecutionReport({ notes: [] }));

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("### Notes");
    });
  });

  describe("postRemediationResolutions", () => {
    it("replies to each PR comment mapped by findingId and posts a summary table", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      const resolutions = [
        makeResolution({ findingId: "f1", status: "accepted" }),
        makeResolution({ findingId: "f2", status: "rejected", action: "No change", rationale: "Not valid" }),
      ];

      await svc.postRemediationResolutions("test-repo", 42, resolutions, { f1: 101, f2: 102 });

      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "test-repo",
        42,
        101,
        expect.stringContaining(":white_check_mark: **accepted**"),
      );
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "test-repo",
        42,
        102,
        expect.stringContaining(":no_entry_sign: **rejected**"),
      );
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "test-repo",
        42,
        expect.stringContaining("## AI Remediation Summary"),
      );
    });

    it("skips replying for a resolution with no matching comment id", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.postRemediationResolutions(
        "test-repo",
        42,
        [makeResolution({ findingId: "unmapped" })],
        {},
      );

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).toHaveBeenCalled();
    });

    it("uses a grey-question icon for an unrecognized status", async () => {
      const githubClient = makeGithubClient();
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await svc.postRemediationResolutions(
        "test-repo",
        42,
        [makeResolution({ findingId: "f1", status: "partially_addressed" as never })],
        { f1: 101 },
      );

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain(":warning:");
    });

    it("propagates an error thrown while replying to a review comment", async () => {
      const githubClient = makeGithubClient();
      githubClient.replyToReviewComment.mockRejectedValue(new Error("comment gone"));
      const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

      await expect(
        svc.postRemediationResolutions(
          "test-repo",
          42,
          [makeResolution({ findingId: "f1" })],
          { f1: 101 },
        ),
      ).rejects.toThrow("comment gone");
    });
  });
});
