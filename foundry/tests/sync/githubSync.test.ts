import { describe, it, expect, vi } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Finding } from "../../src/schemas/review.js";
import type { ResolutionItem } from "../../src/schemas/remediation.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeMockGithubClient() {
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
    branchName: "ai/lin-1",
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
    severity: "blocker",
    type: "bug",
    file: "src/foo.ts",
    title: "Off by one",
    details: "Loop bound is wrong",
    ...overrides,
  };
}

function makeReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: [],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks solid",
    ...overrides,
  };
}

describe("GitHubSyncService", () => {
  describe("syncState", () => {
    it("does nothing when the run has no PR number", async () => {
      const client = makeMockGithubClient();
      const svc = new GitHubSyncService(client as never, makeMockLogger() as never);
      await svc.syncState(makeRun({ prNumber: null, state: RunState.ReadyForHumanReview }));
      expect(client.markPRReady).not.toHaveBeenCalled();
      expect(client.commentOnPR).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when state is ReadyForHumanReview", async () => {
      const client = makeMockGithubClient();
      const logger = makeMockLogger();
      const svc = new GitHubSyncService(client as never, logger as never);
      const run = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7, repo: "acme/x" });
      await svc.syncState(run);

      expect(client.markPRReady).toHaveBeenCalledWith("acme/x", 7);
      expect(client.commentOnPR).toHaveBeenCalledWith(
        "acme/x",
        7,
        "All AI checks passed. Ready for human review.",
      );
      expect(logger.debug).toHaveBeenCalled();
    });

    it("does not mark ready for other states even with a PR number", async () => {
      const client = makeMockGithubClient();
      const svc = new GitHubSyncService(client as never, makeMockLogger() as never);
      await svc.syncState(makeRun({ state: RunState.Implementing, prNumber: 7 }));
      expect(client.markPRReady).not.toHaveBeenCalled();
      expect(client.commentOnPR).not.toHaveBeenCalled();
    });
  });

  describe("postReviewFindings", () => {
    it("posts inline comments for each finding and maps ids to comment ids", async () => {
      const client = makeMockGithubClient();
      client.createPRReviewComment
        .mockResolvedValueOnce(101)
        .mockResolvedValueOnce(102);
      const svc = new GitHubSyncService(client as never, makeMockLogger() as never);

      const findings = [
        makeFinding({ id: "f1", severity: "blocker" }),
        makeFinding({ id: "f2", severity: "nit", lineHint: 10 }),
      ];
      const result = await svc.postReviewFindings("acme/x", 7, findings, "approved");

      expect(client.createPRReviewComment).toHaveBeenCalledTimes(2);
      expect(client.createPRReviewComment).toHaveBeenNthCalledWith(
        1,
        "acme/x",
        7,
        expect.stringContaining("[BLOCKER]"),
        "src/foo.ts",
        undefined,
      );
      expect(result.get("f1")).toBe(101);
      expect(result.get("f2")).toBe(102);
      expect(client.submitPRReview).toHaveBeenCalledWith(
        "acme/x",
        7,
        expect.stringContaining("Approved"),
        "APPROVE",
      );
    });

    it("submits REQUEST_CHANGES when verdict is not approved", async () => {
      const client = makeMockGithubClient();
      client.createPRReviewComment.mockResolvedValue(5);
      const svc = new GitHubSyncService(client as never, makeMockLogger() as never);
      await svc.postReviewFindings("acme/x", 7, [makeFinding()], "changes_requested");

      expect(client.submitPRReview).toHaveBeenCalledWith(
        "acme/x",
        7,
        expect.stringContaining("Changes Requested"),
        "REQUEST_CHANGES",
      );
    });

    it("skips mapping a finding when createPRReviewComment returns a falsy id", async () => {
      const client = makeMockGithubClient();
      client.createPRReviewComment.mockResolvedValue(0);
      const svc = new GitHubSyncService(client as never, makeMockLogger() as never);
      const result = await svc.postReviewFindings("acme/x", 7, [makeFinding()], "approved");
      expect(result.size).toBe(0);
    });

    it("handles an empty findings list", async () => {
      const client = makeMockGithubClient();
      const svc = new GitHubSyncService(client as never, makeMockLogger() as never);
      const result = await svc.postReviewFindings("acme/x", 7, [], "approved");
      expect(result.size).toBe(0);
      expect(client.createPRReviewComment).not.toHaveBeenCalled();
      expect(client.submitPRReview).toHaveBeenCalledWith(
        "acme/x",
        7,
        expect.stringContaining("0 finding(s)"),
        "APPROVE",
      );
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("posts a comment with score, checks, and collapses files under the threshold as a plain list", async () => {
      const client = makeMockGithubClient();
      const svc = new GitHubSyncService(client as never, makeMockLogger() as never);
      const report = makeReport({
        score: 0.75,
        filesChanged: ["src/a.ts", "src/b.ts"],
        notes: ["Refactored helper"],
        checks: {
          lint: { status: "pass", details: "clean" },
          typecheck: { status: "fail", details: "2 errors" },
          tests: { status: "skip", details: "not run" },
        },
      });
      await svc.postExecutionReportUpdate("acme/x", 7, report);

      expect(client.commentOnPR).toHaveBeenCalledTimes(1);
      const body = client.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("Score: 75%");
      expect(body).toContain(":white_check_mark: **Lint**");
      expect(body).toContain(":x: **Typecheck**");
      expect(body).toContain(":heavy_minus_sign: **Tests**");
      expect(body).toContain("Files changed (2)");
      expect(body).not.toContain("<details>");
      expect(body).toContain("### Notes");
      expect(body).toContain("Refactored helper");
    });

    it("collapses files changed into a <details> block above the threshold", async () => {
      const client = makeMockGithubClient();
      const svc = new GitHubSyncService(client as never, makeMockLogger() as never);
      const report = makeReport({
        filesChanged: Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`),
      });
      await svc.postExecutionReportUpdate("acme/x", 7, report);

      const body = client.commentOnPR.mock.calls[0][2] as string;
      expect(body).toContain("<details>");
      expect(body).toContain("Files changed (9)");
    });

    it("omits the files and notes sections when both are empty", async () => {
      const client = makeMockGithubClient();
      const svc = new GitHubSyncService(client as never, makeMockLogger() as never);
      const report = makeReport({ filesChanged: [], notes: [] });
      await svc.postExecutionReportUpdate("acme/x", 7, report);

      const body = client.commentOnPR.mock.calls[0][2] as string;
      expect(body).not.toContain("Files changed");
      expect(body).not.toContain("### Notes");
    });
  });

  describe("postRemediationResolutions", () => {
    it("replies to mapped comments and posts a summary table", async () => {
      const client = makeMockGithubClient();
      const svc = new GitHubSyncService(client as never, makeMockLogger() as never);
      const resolutions: ResolutionItem[] = [
        { findingId: "f1", status: "accepted", action: "Fixed the bug", rationale: "Was wrong" },
        {
          findingId: "f2",
          status: "rejected",
          action: "No change",
          rationale: "Not applicable",
        },
        {
          findingId: "f3",
          status: "partially_addressed",
          action: "Partial fix",
          rationale: "Time constraints",
        },
      ];
      const commentMap: Record<string, number> = { f1: 101, f2: 102 };

      await svc.postRemediationResolutions("acme/x", 7, resolutions, commentMap);

      expect(client.replyToReviewComment).toHaveBeenCalledTimes(2);
      expect(client.replyToReviewComment).toHaveBeenCalledWith(
        "acme/x",
        7,
        101,
        expect.stringContaining("accepted"),
      );
      expect(client.replyToReviewComment).toHaveBeenCalledWith(
        "acme/x",
        7,
        102,
        expect.stringContaining("rejected"),
      );
      // f3 has no mapped GH comment id, so no reply for it.
      expect(client.replyToReviewComment).not.toHaveBeenCalledWith(
        "acme/x",
        7,
        undefined,
        expect.anything(),
      );

      expect(client.commentOnPR).toHaveBeenCalledTimes(1);
      const summary = client.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain("AI Remediation Summary");
      expect(summary).toContain("f1");
      expect(summary).toContain("partially addressed");
    });

    it("uses a fallback icon for an unrecognized status", async () => {
      const client = makeMockGithubClient();
      const svc = new GitHubSyncService(client as never, makeMockLogger() as never);
      const resolutions = [
        {
          findingId: "f1",
          status: "unknown_status" as unknown as ResolutionItem["status"],
          action: "Did something",
          rationale: "Because",
        },
      ];
      await svc.postRemediationResolutions("acme/x", 7, resolutions, { f1: 55 });

      expect(client.replyToReviewComment).toHaveBeenCalledWith(
        "acme/x",
        7,
        55,
        expect.stringContaining(":grey_question:"),
      );
      const summary = client.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain(":grey_question:");
    });

    it("handles an empty resolutions list without replying or erroring", async () => {
      const client = makeMockGithubClient();
      const svc = new GitHubSyncService(client as never, makeMockLogger() as never);
      await svc.postRemediationResolutions("acme/x", 7, [], {});

      expect(client.replyToReviewComment).not.toHaveBeenCalled();
      expect(client.commentOnPR).toHaveBeenCalledTimes(1);
      const summary = client.commentOnPR.mock.calls[0][2] as string;
      expect(summary).toContain("AI Remediation Summary");
    });
  });
});
