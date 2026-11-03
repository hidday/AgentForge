import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearClient, LinearIssue, IssueSearchFilter } from "../../src/linear/linearClient.js";
import type { RunRepository } from "../../src/orchestrator/runRepository.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import type { RepoRegistry, RepoEntry } from "../../src/config/repoRegistry.js";
import type { Logger } from "../../src/utils/logger.js";
import type { Run } from "../../src/domain/types.js";

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: () => makeLogger(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Fix bug",
    description: "desc",
    branchName: "ai/eng-1",
    state: "Todo",
    labels: [],
    priority: 1,
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
      maxDiffLines: 100,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    ...overrides,
  };
}

describe("LinearPollService", () => {
  let linearClient: { searchIssues: ReturnType<typeof vi.fn> };
  let runRepo: { findActiveByIssueId: ReturnType<typeof vi.fn> };
  let orchestrator: { startRun: ReturnType<typeof vi.fn> };
  let repoRegistry: { listRepos: ReturnType<typeof vi.fn> };
  let logger: Logger;
  let service: LinearPollService;

  beforeEach(() => {
    linearClient = { searchIssues: vi.fn().mockResolvedValue([]) };
    runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    orchestrator = { startRun: vi.fn().mockResolvedValue({} as Run) };
    repoRegistry = { listRepos: vi.fn().mockReturnValue([]) };
    logger = makeLogger();
    service = new LinearPollService(
      linearClient as unknown as LinearClient,
      runRepo as unknown as RunRepository,
      orchestrator as unknown as OrchestratorService,
      repoRegistry as unknown as RepoRegistry,
      logger,
    );
  });

  describe("discoverPendingIssues", () => {
    it("returns [] and warns when no repos are configured for Linear polling", async () => {
      repoRegistry.listRepos.mockReturnValue([
        makeRepoEntry({ linearProject: undefined, assigneeMe: undefined }),
      ]);

      const result = await service.discoverPendingIssues();

      expect(result).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
      expect(linearClient.searchIssues).not.toHaveBeenCalled();
    });

    it("builds one filter per repo with linearProject or assigneeMe set", async () => {
      repoRegistry.listRepos.mockReturnValue([
        makeRepoEntry({ name: "a", linearProject: "Project A" }),
        makeRepoEntry({ name: "b", assigneeMe: true, linearTeam: "ENG" }),
        makeRepoEntry({ name: "c" }), // excluded: neither set
      ]);
      linearClient.searchIssues.mockResolvedValue([]);

      await service.discoverPendingIssues();

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
        team: "ENG",
        state: "Todo",
      });
    });

    it("excludes issues that already have an active run", async () => {
      repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ linearProject: "P" })]);
      const issue = makeIssue({ id: "issue-1" });
      linearClient.searchIssues.mockResolvedValue([issue]);
      runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-1" } as unknown as Run);

      const result = await service.discoverPendingIssues();

      expect(result).toEqual([]);
    });

    it("includes issues with no active run", async () => {
      repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ linearProject: "P" })]);
      const issue = makeIssue({ id: "issue-1" });
      linearClient.searchIssues.mockResolvedValue([issue]);
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      const result = await service.discoverPendingIssues();

      expect(result).toEqual([issue]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ candidateCount: 1 }),
        "Discovered pending Linear issues",
      );
    });

    it("de-duplicates an issue id returned by multiple filters", async () => {
      repoRegistry.listRepos.mockReturnValue([
        makeRepoEntry({ name: "a", linearProject: "P1" }),
        makeRepoEntry({ name: "b", linearProject: "P2" }),
      ]);
      const sharedIssue = makeIssue({ id: "dup-1" });
      linearClient.searchIssues
        .mockResolvedValueOnce([sharedIssue])
        .mockResolvedValueOnce([sharedIssue]);

      const result = await service.discoverPendingIssues();

      expect(result).toHaveLength(1);
      expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(1);
    });
  });

  describe("startRunsForIssues", () => {
    it("returns empty started/skipped for an empty input list", async () => {
      const result = await service.startRunsForIssues([]);

      expect(result).toEqual({ started: [], skipped: [] });
      expect(logger.info).toHaveBeenCalledWith(
        { started: 0, skipped: 0 },
        "Ingested Linear issues",
      );
    });

    it("skips an issue that already has an active run, without starting it", async () => {
      runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-1" } as unknown as Run);

      const result = await service.startRunsForIssues(["issue-1"]);

      expect(result).toEqual({ started: [], skipped: ["issue-1"] });
      expect(orchestrator.startRun).not.toHaveBeenCalled();
    });

    it("starts a run for an issue with no active run", async () => {
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      const result = await service.startRunsForIssues(["issue-1"]);

      expect(result).toEqual({ started: ["issue-1"], skipped: [] });
      expect(orchestrator.startRun).toHaveBeenCalledWith("issue-1");
    });

    it("treats a startRun failure as skipped and logs the error", async () => {
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      orchestrator.startRun.mockRejectedValue(new Error("boom"));

      const result = await service.startRunsForIssues(["issue-1"]);

      expect(result).toEqual({ started: [], skipped: ["issue-1"] });
      expect(logger.error).toHaveBeenCalled();
    });

    it("stringifies a non-Error startRun failure in the logged error", async () => {
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      orchestrator.startRun.mockRejectedValue("non-error failure");

      const result = await service.startRunsForIssues(["issue-1"]);

      expect(result).toEqual({ started: [], skipped: ["issue-1"] });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: "issue-1", error: "non-error failure" }),
        expect.any(String),
      );
    });

    it("handles a mix of started and skipped issues across multiple ids", async () => {
      runRepo.findActiveByIssueId
        .mockResolvedValueOnce(null) // issue-1: starts
        .mockResolvedValueOnce({ id: "run-x" } as unknown as Run) // issue-2: skipped (active)
        .mockResolvedValueOnce(null); // issue-3: throws on startRun
      orchestrator.startRun
        .mockResolvedValueOnce({} as Run)
        .mockRejectedValueOnce(new Error("fail"));

      const result = await service.startRunsForIssues(["issue-1", "issue-2", "issue-3"]);

      expect(result.started).toEqual(["issue-1"]);
      expect(result.skipped).toEqual(["issue-2", "issue-3"]);
    });
  });
});
