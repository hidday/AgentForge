import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    title: "Fix bug",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "/tmp/repo-a",
    defaultBranch: "main",
    allowedPaths: [],
    protectedPaths: [],
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    ...overrides,
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "repo-a",
    branchName: null,
    prNumber: null,
    state: RunState.Planning,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeDeps() {
  const linearClient = { searchIssues: vi.fn() };
  const runRepo = { findActiveByIssueId: vi.fn() };
  const orchestrator = { startRun: vi.fn() };
  const repoRegistry = { listRepos: vi.fn() };
  const logger = makeLogger();
  const svc = new LinearPollService(
    linearClient as never,
    runRepo as never,
    orchestrator as never,
    repoRegistry as never,
    logger as never,
  );
  return { svc, linearClient, runRepo, orchestrator, repoRegistry, logger };
}

describe("LinearPollService", () => {
  describe("discoverPendingIssues", () => {
    it("warns and returns empty when no repos have linearProject or assigneeMe configured", async () => {
      const { svc, repoRegistry, logger, linearClient } = makeDeps();
      repoRegistry.listRepos.mockReturnValue([makeRepoEntry()]);

      const result = await svc.discoverPendingIssues();

      expect(result).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
      expect(linearClient.searchIssues).not.toHaveBeenCalled();
    });

    it("builds a filter per eligible repo and returns candidates without an active run", async () => {
      const { svc, repoRegistry, linearClient, runRepo, logger } = makeDeps();
      repoRegistry.listRepos.mockReturnValue([
        makeRepoEntry({ name: "a", linearProject: "Project A" }),
        makeRepoEntry({ name: "b", assigneeMe: true, linearTeam: "TEAM" }),
        makeRepoEntry({ name: "c" }),
      ]);
      linearClient.searchIssues
        .mockResolvedValueOnce([makeIssue({ id: "i1" })])
        .mockResolvedValueOnce([makeIssue({ id: "i2" })]);
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      const result = await svc.discoverPendingIssues();

      expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
      expect(linearClient.searchIssues).toHaveBeenCalledWith({
        projectName: "Project A",
        assigneeMe: undefined,
        team: undefined,
        state: "Todo",
      });
      expect(linearClient.searchIssues).toHaveBeenCalledWith({
        projectName: undefined,
        assigneeMe: true,
        team: "TEAM",
        state: "Todo",
      });
      expect(result.map((i) => i.id)).toEqual(["i1", "i2"]);
      expect(logger.info).toHaveBeenCalled();
    });

    it("dedupes issues seen across multiple filters and skips ones with an active run", async () => {
      const { svc, repoRegistry, linearClient, runRepo } = makeDeps();
      repoRegistry.listRepos.mockReturnValue([
        makeRepoEntry({ name: "a", linearProject: "A" }),
        makeRepoEntry({ name: "b", linearProject: "B" }),
      ]);
      const shared = makeIssue({ id: "shared" });
      linearClient.searchIssues
        .mockResolvedValueOnce([shared, makeIssue({ id: "active" })])
        .mockResolvedValueOnce([shared]);
      runRepo.findActiveByIssueId.mockImplementation(async (id: string) =>
        id === "active" ? makeRun() : null,
      );

      const result = await svc.discoverPendingIssues();

      expect(result.map((i) => i.id)).toEqual(["shared"]);
      // findActiveByIssueId is only checked once per unique issue id.
      expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(2);
    });
  });

  describe("startRunsForIssues", () => {
    it("skips issues that already have an active run", async () => {
      const { svc, runRepo, orchestrator, logger } = makeDeps();
      runRepo.findActiveByIssueId.mockResolvedValue(makeRun());

      const result = await svc.startRunsForIssues(["issue-1"]);

      expect(result).toEqual({ started: [], skipped: ["issue-1"] });
      expect(orchestrator.startRun).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        { started: 0, skipped: 1 },
        "Ingested Linear issues",
      );
    });

    it("starts a run for issues with none active", async () => {
      const { svc, runRepo, orchestrator } = makeDeps();
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      orchestrator.startRun.mockResolvedValue(makeRun());

      const result = await svc.startRunsForIssues(["issue-1"]);

      expect(result).toEqual({ started: ["issue-1"], skipped: [] });
      expect(orchestrator.startRun).toHaveBeenCalledWith("issue-1");
    });

    it("catches a startRun failure, logs it, and marks the issue skipped", async () => {
      const { svc, runRepo, orchestrator, logger } = makeDeps();
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      orchestrator.startRun.mockRejectedValue(new Error("boom"));

      const result = await svc.startRunsForIssues(["issue-1"]);

      expect(result).toEqual({ started: [], skipped: ["issue-1"] });
      expect(logger.error).toHaveBeenCalledWith(
        { issueId: "issue-1", error: "boom" },
        "Failed to start run for issue",
      );
    });

    it("falls back to String(err) when startRun rejects with a non-Error value", async () => {
      const { svc, runRepo, orchestrator, logger } = makeDeps();
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      orchestrator.startRun.mockRejectedValue("plain string failure");

      await svc.startRunsForIssues(["issue-1"]);

      expect(logger.error).toHaveBeenCalledWith(
        { issueId: "issue-1", error: "plain string failure" },
        "Failed to start run for issue",
      );
    });

    it("processes a mix of skipped, started, and failed issues in one batch", async () => {
      const { svc, runRepo, orchestrator } = makeDeps();
      runRepo.findActiveByIssueId.mockImplementation(async (id: string) =>
        id === "has-run" ? makeRun() : null,
      );
      orchestrator.startRun.mockImplementation(async (id: string) => {
        if (id === "fails") throw new Error("nope");
        return makeRun();
      });

      const result = await svc.startRunsForIssues(["has-run", "fails", "ok"]);

      expect(result.skipped.sort()).toEqual(["fails", "has-run"]);
      expect(result.started).toEqual(["ok"]);
    });
  });
});
