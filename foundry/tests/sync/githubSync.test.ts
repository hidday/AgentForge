import { describe, it, expect, vi } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Finding } from "../../src/schemas/review.js";
import type { ResolutionItem } from "../../src/schemas/remediation.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Logger } from "../../src/utils/logger.js";
import type { GitHubClient } from "../../src/github/githubClient.js";

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
    id: "finding-1",
    severity: "blocker",
    type: "bug",
    file: "src/a.ts",
    lineHint: 12,
    title: "Null deref",
    details: "This can crash.",
    ...overrides,
  };
}

function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
  return {
    findingId: "finding-1",
    status: "accepted",
    action: "Fixed the null check",
    rationale: "It was a real bug",
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
      typecheck: { status: "pass", details: "no issues" },
      tests: { status: "fail", details: "1 test failed" },
    },
    notes: ["Consider adding more tests"],
    prDraftCreated: true,
    score: 0.75,
    scoreRationale: "Mostly good, one test failing",
    ...overrides,
  };
}

function makeGithubClient(): {
  [K in keyof GitHubClient]: ReturnType<typeof vi.fn>;
} {
  return {
    verifyRepoAccess: vi.fn().mockResolvedValue(undefined),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
    createBranch: vi.fn().mockResolvedValue(undefined),
    createDraftPR: vi.fn().mockResolvedValue(1),
    commentOnPR: vi.fn().mockResolvedValue(undefined),
    getPRDiff: vi.fn().mockResolvedValue(""),
    markPRReady: vi.fn().mockResolvedValue(undefined),
    listPRComments: vi.fn().mockResolvedValue([]),
    createPRReviewComment: vi.fn().mockResolvedValue(1000),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
    submitPRReview: vi.fn().mockResolvedValue(undefined),
  };
}

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

describe("GitHubSyncService", () => {
  describe("syncState", () => {
    it("is a no-op when run.prNumber is falsy", async () => {
      const githubClient = makeGithubClient();
      const logger = makeLogger();
      const service = new GitHubSyncService(githubClient as unknown as GitHubClient, logger);
      const run = makeRun({ prNumber: null, state: RunState.ReadyForHumanReview });

      await service.syncState(run);

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });

    it("marks the PR ready and comments when state is ReadyForHumanReview", async () => {
      const githubClient = makeGithubClient();
      const logger = makeLogger();
      const service = new GitHubSyncService(githubClient as unknown as GitHubClient, logger);
      const run = makeRun({ prNumber: 42, state: RunState.ReadyForHumanReview, repo: "owner/repo" });

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

    it("is a no-op for any other state, even with prNumber set", async () => {
      const githubClient = makeGithubClient();
      const logger = makeLogger();
      const service = new GitHubSyncService(githubClient as unknown as GitHubClient, logger);
      const run = makeRun({ prNumber: 42, state: RunState.Implementing });

      await service.syncState(run);

      expect(githubClient.markPRReady).not.toHaveBeenCalled();
      expect(githubClient.commentOnPR).not.toHaveBeenCalled();
    });
  });

  describe("postReviewFindings", () => {
    it("posts each finding as an inline review comment with the exact body format and collects returned ids", async () => {
      const githubClient = makeGithubClient();
      const logger = makeLogger();
      const service = new GitHubSyncService(githubClient as unknown as GitHubClient, logger);
      const findings = [
        makeFinding({ id: "f1", severity: "blocker", title: "Bug A", details: "Detail A", file: "a.ts", lineHint: 5 }),
        makeFinding({ id: "f2", severity: "nit", title: "Bug B", details: "Detail B", file: "b.ts", lineHint: undefined }),
      ];
      githubClient.createPRReviewComment
        .mockResolvedValueOnce(2001)
        .mockResolvedValueOnce(2002);

      const result = await service.postReviewFindings("owner/repo", 42, findings, "changes_requested");

      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        1,
        "owner/repo",
        42,
        "**[BLOCKER]** Bug A\n\nDetail A",
        "a.ts",
        5,
      );
      expect(githubClient.createPRReviewComment).toHaveBeenNthCalledWith(
        2,
        "owner/repo",
        42,
        "**[NIT]** Bug B\n\nDetail B",
        "b.ts",
        undefined,
      );
      expect(result).toEqual(
        new Map([
          ["f1", 2001],
          ["f2", 2002],
        ]),
      );
    });

    it("does not add a finding to the map when createPRReviewComment resolves a falsy commentId", async () => {
      const githubClient = makeGithubClient();
      const logger = makeLogger();
      const service = new GitHubSyncService(githubClient as unknown as GitHubClient, logger);
      const findings = [makeFinding({ id: "f1" })];
      githubClient.createPRReviewComment.mockResolvedValueOnce(0);

      const result = await service.postReviewFindings("owner/repo", 42, findings, "approved");

      expect(result.size).toBe(0);
      expect(result.has("f1")).toBe(false);
    });

    it("submits an APPROVE review with the exact summary text when verdict is 'approved'", async () => {
      const githubClient = makeGithubClient();
      const logger = makeLogger();
      const service = new GitHubSyncService(githubClient as unknown as GitHubClient, logger);
      const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2" })];

      await service.postReviewFindings("owner/repo", 42, findings, "approved");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "owner/repo",
        42,
        "AI Code Review: Approved\n\n2 finding(s) posted as inline comments.",
        "APPROVE",
      );
    });

    it("submits a REQUEST_CHANGES review with the exact summary text for any other verdict", async () => {
      const githubClient = makeGithubClient();
      const logger = makeLogger();
      const service = new GitHubSyncService(githubClient as unknown as GitHubClient, logger);
      const findings: Finding[] = [];

      await service.postReviewFindings("owner/repo", 42, findings, "changes_requested");

      expect(githubClient.submitPRReview).toHaveBeenCalledWith(
        "owner/repo",
        42,
        "AI Code Review: Changes Requested\n\n0 finding(s) posted as inline comments.",
        "REQUEST_CHANGES",
      );
      expect(logger.info).toHaveBeenCalledWith(
        {
          repo: "owner/repo",
          prNumber: 42,
          findingsCount: 0,
          verdict: "changes_requested",
          mappedComments: 0,
        },
        "Posted review findings as PR review comments",
      );
    });
  });

  describe("postExecutionReportUpdate", () => {
    it("posts a comment with score, checks, files-changed (short list), and notes sections", async () => {
      const githubClient = makeGithubClient();
      const logger = makeLogger();
      const service = new GitHubSyncService(githubClient as unknown as GitHubClient, logger);
      const report = makeExecutionReport();

      await service.postExecutionReportUpdate("owner/repo", 42, report);

      expect(githubClient.commentOnPR).toHaveBeenCalledTimes(1);
      const [repo, prNumber, body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
      expect(repo).toBe("owner/repo");
      expect(prNumber).toBe(42);
      expect(body).toContain("## AI Execution Report (v1) -- Score: 75%");
      expect(body).toContain("*Mostly good, one test failing*");
      expect(body).toContain("Implemented the feature");
      expect(body).toContain(":white_check_mark: **Lint** -- no issues");
      expect(body).toContain(":white_check_mark: **Typecheck** -- no issues");
      expect(body).toContain(":x: **Tests** -- 1 test failed");
      expect(body).toContain("### Files changed (2)");
      expect(body).toContain("- `src/a.ts`");
      expect(body).toContain("- `src/b.ts`");
      expect(body).not.toContain("<details>");
      expect(body).toContain("### Notes");
      expect(body).toContain("- Consider adding more tests");

      expect(logger.info).toHaveBeenCalledWith(
        {
          repo: "owner/repo",
          prNumber: 42,
          executionVersion: 1,
          score: 0.75,
          filesChanged: 2,
        },
        "Posted execution report update to PR",
      );
    });

    it("uses a heavy_minus_sign icon for a 'skip' check status", async () => {
      const githubClient = makeGithubClient();
      const logger = makeLogger();
      const service = new GitHubSyncService(githubClient as unknown as GitHubClient, logger);
      const report = makeExecutionReport({
        checks: {
          lint: { status: "skip", details: "not run" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });

      await service.postExecutionReportUpdate("owner/repo", 42, report);

      const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
      expect(body).toContain(":heavy_minus_sign: **Lint** -- not run");
    });

    it("collapses files-changed into a <details> block above the collapse threshold", async () => {
      const githubClient = makeGithubClient();
      const logger = makeLogger();
      const service = new GitHubSyncService(githubClient as unknown as GitHubClient, logger);
      const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${String(i)}.ts`);
      const report = makeExecutionReport({ filesChanged: manyFiles });

      await service.postExecutionReportUpdate("owner/repo", 42, report);

      const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
      expect(body).toContain("<details>");
      expect(body).toContain("<summary><strong>Files changed (9)</strong></summary>");
      expect(body).toContain("</details>");
    });

    it("omits the files-changed section entirely when no files changed", async () => {
      const githubClient = makeGithubClient();
      const logger = makeLogger();
      const service = new GitHubSyncService(githubClient as unknown as GitHubClient, logger);
      const report = makeExecutionReport({ filesChanged: [] });

      await service.postExecutionReportUpdate("owner/repo", 42, report);

      const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
      expect(body).not.toContain("Files changed");
    });

    it("omits the notes section entirely when there are no notes", async () => {
      const githubClient = makeGithubClient();
      const logger = makeLogger();
      const service = new GitHubSyncService(githubClient as unknown as GitHubClient, logger);
      const report = makeExecutionReport({ notes: [] });

      await service.postExecutionReportUpdate("owner/repo", 42, report);

      const [, , body] = githubClient.commentOnPR.mock.calls[0] as [string, number, string];
      expect(body).not.toContain("### Notes");
    });
  });

  describe("postRemediationResolutions", () => {
    it("replies to each mapped finding's comment with the exact icon/status/action/rationale format", async () => {
      const githubClient = makeGithubClient();
      const logger = makeLogger();
      const service = new GitHubSyncService(githubClient as unknown as GitHubClient, logger);
      const resolutions = [
        makeResolution({ findingId: "f1", status: "accepted", action: "Fixed it", rationale: "Was real" }),
        makeResolution({ findingId: "f2", status: "rejected", action: "No change", rationale: "Not a bug" }),
        makeResolution({
          findingId: "f3",
          status: "partially_addressed",
          action: "Partial fix",
          rationale: "Time constraints",
        }),
      ];
      const commentMap = { f1: 2001, f2: 2002, f3: 2003 };

      await service.postRemediationResolutions("owner/repo", 42, resolutions, commentMap);

      expect(githubClient.replyToReviewComment).toHaveBeenNthCalledWith(
        1,
        "owner/repo",
        42,
        2001,
        ":white_check_mark: **accepted**\n\n**Action:** Fixed it\n**Rationale:** Was real",
      );
      expect(githubClient.replyToReviewComment).toHaveBeenNthCalledWith(
        2,
        "owner/repo",
        42,
        2002,
        ":no_entry_sign: **rejected**\n\n**Action:** No change\n**Rationale:** Not a bug",
      );
      expect(githubClient.replyToReviewComment).toHaveBeenNthCalledWith(
        3,
        "owner/repo",
        42,
        2003,
        ":warning: **partially addressed**\n\n**Action:** Partial fix\n**Rationale:** Time constraints",
      );
    });

    it("uses the grey_question fallback icon for an unrecognized status", async () => {
      const githubClient = makeGithubClient();
      const logger = makeLogger();
      const service = new GitHubSyncService(githubClient as unknown as GitHubClient, logger);
      const resolutions = [
        makeResolution({ findingId: "f1", status: "unknown_status" as ResolutionItem["status"] }),
      ];
      const commentMap = { f1: 2001 };

      await service.postRemediationResolutions("owner/repo", 42, resolutions, commentMap);

      expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
        "owner/repo",
        42,
        2001,
        expect.stringContaining(":grey_question:"),
      );
    });

    it("skips replying when a resolution's findingId is not in commentMap", async () => {
      const githubClient = makeGithubClient();
      const logger = makeLogger();
      const service = new GitHubSyncService(githubClient as unknown as GitHubClient, logger);
      const resolutions = [makeResolution({ findingId: "unmapped" })];

      await service.postRemediationResolutions("owner/repo", 42, resolutions, {});

      expect(githubClient.replyToReviewComment).not.toHaveBeenCalled();
    });

    it("posts a markdown summary table comment with a row per resolution", async () => {
      const githubClient = makeGithubClient();
      const logger = makeLogger();
      const service = new GitHubSyncService(githubClient as unknown as GitHubClient, logger);
      const resolutions = [
        makeResolution({ findingId: "f1", status: "accepted", action: "Fixed it", rationale: "Was real" }),
      ];

      await service.postRemediationResolutions("owner/repo", 42, resolutions, { f1: 2001 });

      expect(githubClient.commentOnPR).toHaveBeenCalledWith(
        "owner/repo",
        42,
        [
          "## AI Remediation Summary",
          "",
          "| Finding | Status | Action | Rationale |",
          "|---------|--------|--------|-----------|",
          "| :white_check_mark: **f1** | accepted | Fixed it | Was real |",
        ].join("\n"),
      );
      expect(logger.info).toHaveBeenCalledWith(
        {
          repo: "owner/repo",
          prNumber: 42,
          resolutionCount: 1,
          repliedTo: 1,
        },
        "Posted remediation resolutions to PR",
      );
    });
  });
});
