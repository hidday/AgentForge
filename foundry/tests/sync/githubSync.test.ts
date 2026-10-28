import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Finding } from "../../src/schemas/review.js";
import type { ResolutionItem } from "../../src/schemas/remediation.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  child: () => noopLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "lin-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: "feature/x",
    prNumber: 42,
    state: RunState.ReadyForHumanReview,
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

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "important",
    type: "bug",
    file: "src/a.ts",
    lineHint: 10,
    title: "Missing null check",
    details: "req.body can be undefined.",
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
      tests: { status: "pass", details: "47 passed" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks solid",
    ...overrides,
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
  let service: GitHubSyncService;

  beforeEach(() => {
    githubClient = makeGithubClient();
    service = new GitHubSyncService(githubClient as never, noopLogger);
  });

  describe("syncState", () => {
    it("does nothing when the run has no PR number", async () => {
      await service.syncState(makeRun({ prNumber: null }));
      expect(githubClient.markPRReady).not.toHaveBeenCalled();
    });

    it("does nothing when the run is not ReadyForHumanReview", async () => {
      await service.syncState(makeRun({ state: RunState.Implementing }));
      expect(githubClient.markPRReady).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when ReadyForHumanReview", async () => {
      await service.syncState(makeRun());
      expect(githubClient.markPRReady).toHaveBeenCalledWith("org/repo", 42);
      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "org/repo",
        42,
        expect.stringContaining("Ready for human review"),
      );
    });
  });

  describe("postReviewFindings", () => {
    it("posts a review comment per finding and maps finding id to comment id", async () => {
      githubClient.createPRReviewComment.mockResolvedValueOnce(101).mockResolvedValueOnce(102);

      const result = await service.postReviewFindings(
        "org/repo",
        42,
        [makeFinding({ id: "f1" }), makeFinding({ id: "f2" })],
        "changes_requested",
      );

      expect(result.get("f1")).toBe(101);
      expect(result.get("f2")).toBe(102);
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "org/repo",
        42,
        expect.stringContaining("Changes Requested"),
        "REQUEST_CHANGES",
      );
    });

    it("does not map a finding whose review comment could not be posted (commentId 0)", async () => {
      githubClient.createPRReviewComment.mockResolvedValue(0);

      const result = await service.postReviewFindings(
        "org/repo",
        42,
        [makeFinding()],
        "approved",
      );

      expect(result.size).toBe(0);
      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "org/repo",
        42,
        expect.stringContaining("Approved"),
        "APPROVE",
      );
    });

    it("handles an empty findings list", async () => {
      const result = await service.postReviewFindings("org/repo", 42, [], "approved");
      expect(result.size).toBe(0);
      expect(githubClient.createPRReviewComment).not.toHaveBeenCalled();
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("renders a short file list without a collapsible section for <= 8 files", async () => {
      await service.postExecutionReportUpdate(
        "org/repo",
        42,
        makeExecutionReport({ filesChanged: ["a.ts", "b.ts"] }),
      );

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("Files changed (2)");
      expect(body).not.toContain("<details>");
    });

    it("renders a collapsible <details> section for more than 8 files", async () => {
      const files = Array.from({ length: 9 }, (_, i) => `file${i}.ts`);
      await service.postExecutionReportUpdate(
        "org/repo",
        42,
        makeExecutionReport({ filesChanged: files }),
      );

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
    });

    it("omits the files section entirely when nothing changed", async () => {
      await service.postExecutionReportUpdate(
        "org/repo",
        42,
        makeExecutionReport({ filesChanged: [] }),
      );

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("Files changed");
    });

    it("includes a Notes section only when notes are present", async () => {
      await service.postExecutionReportUpdate(
        "org/repo",
        42,
        makeExecutionReport({ notes: ["Added a dependency"] }),
      );

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("### Notes");
      expect(body).toContain("Added a dependency");
    });

    it("uses the correct icon per check status", async () => {
      await service.postExecutionReportUpdate(
        "org/repo",
        42,
        makeExecutionReport({
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "fail", details: "type error" },
            tests: { status: "skip", details: "skipped" },
          },
        }),
      );

      const body = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain(":white_check_mark:");
      expect(body).toContain(":x:");
      expect(body).toContain(":heavy_minus_sign:");
    });
  });

  describe("postRemediationResolutions", () => {
    it("replies on review comments for resolutions with a mapped comment id", async () => {
      const resolutions: ResolutionItem[] = [
        { findingId: "f1", status: "accepted", action: "Fixed it", rationale: "Was a real bug" },
        { findingId: "f2", status: "rejected", action: "No change", rationale: "Out of scope" },
      ];

      await service.postRemediationResolutions("org/repo", 42, resolutions, { f1: 101 });

      expect(githubClient.replyToReviewComment).toHaveBeenCalledTimes(1);
      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "org/repo",
        42,
        101,
        expect.stringContaining("accepted"),
      );
      const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain("f1");
      expect(summary).toContain("f2");
    });

    it("falls back to a question-mark icon for an unrecognized status", async () => {
      const resolutions = [
        { findingId: "f1", status: "weird" as ResolutionItem["status"], action: "a", rationale: "r" },
      ];

      await service.postRemediationResolutions("org/repo", 42, resolutions, {});

      const summary = githubClient.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain(":grey_question:");
    });

    it("does not reply when no comment id is mapped for a finding", async () => {
      const resolutions: ResolutionItem[] = [
        { findingId: "f1", status: "accepted", action: "a", rationale: "r" },
      ];

      await service.postRemediationResolutions("org/repo", 42, resolutions, {});

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    });
  });
});
