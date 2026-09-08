import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    title: "Title",
    description: "desc",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-1",
    directory: "repo-1",
    defaultBranch: "main",
    allowedPaths: ["src"],
    protectedPaths: [],
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 50,
      maxDiffLines: 1000,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
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
    it("returns [] and warns when no repos are configured for polling", async () => {
      const { svc, repoRegistry, logger } = makeDeps();
      repoRegistry.listRepos.mockReturnValue([
        makeRepoEntry({ name: "no-linear", linearProject: undefined, assigneeMe: undefined }),
      ]);

      const result = await svc.discoverPendingIssues();

      expect(result).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("builds a filter per eligible repo and searches with it", async () => {
      const { svc, repoRegistry, linearClient, runRepo } = makeDeps();
      repoRegistry.listRepos.mockReturnValue([
        makeRepoEntry({ name: "r1", linearProject: "Proj1" }),
        makeRepoEntry({ name: "r2", assigneeMe: true, linearTeam: "ENG" }),
      ]);
      linearClient.searchIssues.mockResolvedValue([]);

      await svc.discoverPendingIssues();

      expect(linearClient.searchIssues).toHaveBeenCalledWith({
        projectName: "Proj1",
        assigneeMe: undefined,
        team: undefined,
        state: "Todo",
      });
      expect(linearClient.searchIssues).toHaveBeenCalledWith({
        projectName: undefined,
        assigneeMe: true,
        team: "ENG",
        state: "Todo",
      });
      expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
    });

    it("excludes issues that already have an active run", async () => {
      const { svc, repoRegistry, linearClient, runRepo } = makeDeps();
      repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ linearProject: "Proj1" })]);
      linearClient.searchIssues.mockResolvedValue([
        makeIssue({ id: "issue-1" }),
        makeIssue({ id: "issue-2" }),
      ]);
      runRepo.findActiveByIssueId.mockImplementation((id: string) =>
        Promise.resolve(id === "issue-1" ? { id: "run-1" } : null),
      );

      const result = await svc.discoverPendingIssues();

      expect(result.map((i) => i.id)).toEqual(["issue-2"]);
    });

    it("de-duplicates issues seen across multiple filters", async () => {
      const { svc, repoRegistry, linearClient, runRepo } = makeDeps();
      repoRegistry.listRepos.mockReturnValue([
        makeRepoEntry({ name: "r1", linearProject: "Proj1" }),
        makeRepoEntry({ name: "r2", assigneeMe: true }),
      ]);
      linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "shared-issue" })]);
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      const result = await svc.discoverPendingIssues();

      expect(result).toHaveLength(1);
      expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    });
  });

  describe("startRunsForIssues", () => {
    it("starts a run for each issue with no existing active run", async () => {
      const { svc, orchestrator, runRepo } = makeDeps();
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      orchestrator.startRun.mockResolvedValue({ id: "run-1" });

      const result = await svc.startRunsForIssues(["issue-1", "issue-2"]);

      expect(result.started).toEqual(["issue-1", "issue-2"]);
      expect(result.skipped).toEqual([]);
      expect(orchestrator.startRun).toHaveBeenCalledTimes(2);
    });

    it("skips issues that already have an active run without starting a new one", async () => {
      const { svc, orchestrator, runRepo } = makeDeps();
      runRepo.findActiveByIssueId.mockResolvedValue({ id: "existing-run" });

      const result = await svc.startRunsForIssues(["issue-1"]);

      expect(result.skipped).toEqual(["issue-1"]);
      expect(result.started).toEqual([]);
      expect(orchestrator.startRun).not.toHaveBeenCalled();
    });

    it("skips and logs an error when starting the run throws", async () => {
      const { svc, orchestrator, runRepo, logger } = makeDeps();
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      orchestrator.startRun.mockRejectedValue(new Error("boom"));

      const result = await svc.startRunsForIssues(["issue-1"]);

      expect(result.skipped).toEqual(["issue-1"]);
      expect(result.started).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });

    it("stringifies a non-Error rejection when logging", async () => {
      const { svc, orchestrator, runRepo, logger } = makeDeps();
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      orchestrator.startRun.mockRejectedValue("plain string failure");

      await svc.startRunsForIssues(["issue-1"]);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: "plain string failure" }),
        expect.any(String),
      );
    });

    it("handles a mix of started and skipped issues, and an empty list", async () => {
      const { svc, orchestrator, runRepo } = makeDeps();
      runRepo.findActiveByIssueId.mockImplementation((id: string) =>
        Promise.resolve(id === "already-running" ? { id: "run-x" } : null),
      );
      orchestrator.startRun.mockResolvedValue({ id: "run-new" });

      const result = await svc.startRunsForIssues(["already-running", "fresh-issue"]);

      expect(result.started).toEqual(["fresh-issue"]);
      expect(result.skipped).toEqual(["already-running"]);

      const empty = await svc.startRunsForIssues([]);
      expect(empty).toEqual({ started: [], skipped: [] });
    });
  });
});
