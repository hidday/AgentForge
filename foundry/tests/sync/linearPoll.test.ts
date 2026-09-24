import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeLinearClient() {
  return {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn().mockResolvedValue([]),
    postComment: vi.fn(),
    updateIssueState: vi.fn(),
    addLabel: vi.fn(),
    removeLabel: vi.fn(),
    listLabels: vi.fn(),
  };
}

function makeRunRepo() {
  return {
    create: vi.fn(),
    findAll: vi.fn(),
    findById: vi.fn(),
    findByIssueId: vi.fn(),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    updateState: vi.fn(),
    findRunsNeedingLinearBackfill: vi.fn(),
    update: vi.fn(),
  };
}

function makeOrchestrator() {
  return {
    startRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  };
}

function makeRepoRegistry(repos: Partial<RepoEntry>[]) {
  return {
    listRepos: vi.fn().mockReturnValue(repos),
    getRepoByName: vi.fn(),
    getRepoByLinearProject: vi.fn(),
    getDefaultRepo: vi.fn(),
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
  };
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Fix the thing",
    description: "desc",
    branchName: "eng-1",
    state: "Todo",
    labels: [],
    priority: 1,
    ...overrides,
  };
}

describe("LinearPollService", () => {
  let linearClient: ReturnType<typeof makeLinearClient>;
  let runRepo: ReturnType<typeof makeRunRepo>;
  let orchestrator: ReturnType<typeof makeOrchestrator>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    linearClient = makeLinearClient();
    runRepo = makeRunRepo();
    orchestrator = makeOrchestrator();
    logger = makeLogger();
  });

  function makeService(repos: Partial<RepoEntry>[]) {
    const repoRegistry = makeRepoRegistry(repos);
    return {
      repoRegistry,
      service: new LinearPollService(
        linearClient as never,
        runRepo as never,
        orchestrator as never,
        repoRegistry as never,
        logger as never,
      ),
    };
  }

  describe("discoverPendingIssues", () => {
    it("returns no candidates and warns when no repo is configured for polling", async () => {
      const { service, repoRegistry } = makeService([
        { name: "repo-a", linearProject: undefined, assigneeMe: undefined },
      ]);

      const result = await service.discoverPendingIssues();

      expect(result).toEqual([]);
      expect(repoRegistry.listRepos).toHaveBeenCalled();
      expect(linearClient.searchIssues).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        "No Linear projects or assigneeMe repos configured in repo registry",
      );
    });

    it("builds a search filter per eligible repo and searches Linear with it", async () => {
      const { service } = makeService([
        { name: "repo-a", linearProject: "Project A", linearTeam: "TA", assigneeMe: undefined },
        { name: "repo-b", linearProject: undefined, assigneeMe: true, linearTeam: "TB" },
        { name: "repo-c", linearProject: undefined, assigneeMe: undefined },
      ]);
      linearClient.searchIssues.mockResolvedValue([]);

      await service.discoverPendingIssues();

      expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
      expect(linearClient.searchIssues).toHaveBeenNthCalledWith(1, {
        projectName: "Project A",
        assigneeMe: undefined,
        team: "TA",
        state: "Todo",
      });
      expect(linearClient.searchIssues).toHaveBeenNthCalledWith(2, {
        projectName: undefined,
        assigneeMe: true,
        team: "TB",
        state: "Todo",
      });
    });

    it("excludes issues that already have an active run", async () => {
      const { service } = makeService([{ name: "repo-a", linearProject: "Project A" }]);
      const issue1 = makeIssue({ id: "issue-1" });
      const issue2 = makeIssue({ id: "issue-2" });
      linearClient.searchIssues.mockResolvedValue([issue1, issue2]);
      runRepo.findActiveByIssueId.mockImplementation((id: string) =>
        Promise.resolve(id === "issue-1" ? { id: "run-x" } : null),
      );

      const result = await service.discoverPendingIssues();

      expect(result).toEqual([issue2]);
      expect(runRepo.findActiveByIssueId).toHaveBeenCalledWith("issue-1");
      expect(runRepo.findActiveByIssueId).toHaveBeenCalledWith("issue-2");
    });

    it("dedupes an issue returned by more than one filter", async () => {
      const { service } = makeService([
        { name: "repo-a", linearProject: "Project A" },
        { name: "repo-b", assigneeMe: true },
      ]);
      const issue = makeIssue({ id: "shared-issue" });
      linearClient.searchIssues.mockResolvedValue([issue]);

      const result = await service.discoverPendingIssues();

      expect(result).toEqual([issue]);
      expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(1);
    });

    it("logs candidate count and filter summary", async () => {
      const { service } = makeService([{ name: "repo-a", linearProject: "Project A" }]);
      const issue = makeIssue();
      linearClient.searchIssues.mockResolvedValue([issue]);

      await service.discoverPendingIssues();

      expect(logger.info).toHaveBeenCalledWith(
        {
          candidateCount: 1,
          filters: [{ project: "Project A", assigneeMe: undefined, team: undefined }],
        },
        "Discovered pending Linear issues",
      );
    });
  });

  describe("startRunsForIssues", () => {
    it("starts a run for a new issue", async () => {
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      const result = await service_startRunsForIssues(["issue-1"]);

      expect(orchestrator.startRun).toHaveBeenCalledWith("issue-1");
      expect(result).toEqual({ started: ["issue-1"], skipped: [] });
    });

    it("skips an issue that already has an active run without starting it", async () => {
      runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-existing" });

      const result = await service_startRunsForIssues(["issue-1"]);

      expect(orchestrator.startRun).not.toHaveBeenCalled();
      expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    });

    it("skips and logs an issue whose orchestrator.startRun throws", async () => {
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      orchestrator.startRun.mockRejectedValue(new Error("boom"));

      const result = await service_startRunsForIssues(["issue-1"]);

      expect(result).toEqual({ started: [], skipped: ["issue-1"] });
      expect(logger.error).toHaveBeenCalledWith(
        { issueId: "issue-1", error: "boom" },
        "Failed to start run for issue",
      );
    });

    it("handles a non-Error rejection by stringifying it", async () => {
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      orchestrator.startRun.mockRejectedValue("weird failure");

      await service_startRunsForIssues(["issue-1"]);

      expect(logger.error).toHaveBeenCalledWith(
        { issueId: "issue-1", error: "weird failure" },
        "Failed to start run for issue",
      );
    });

    it("processes a mix of started and skipped issues and logs totals", async () => {
      runRepo.findActiveByIssueId.mockImplementation((id: string) =>
        Promise.resolve(id === "issue-existing" ? { id: "run-x" } : null),
      );

      const result = await service_startRunsForIssues(["issue-new", "issue-existing"]);

      expect(result).toEqual({ started: ["issue-new"], skipped: ["issue-existing"] });
      expect(logger.info).toHaveBeenCalledWith(
        { started: 1, skipped: 1 },
        "Ingested Linear issues",
      );
    });
  });

  // Helper bound to the default repo registry, used by the startRunsForIssues
  // describe block above (that method doesn't touch repoRegistry at all).
  function service_startRunsForIssues(issueIds: string[]) {
    const { service } = makeService([{ name: "repo-a", linearProject: "Project A" }]);
    return service.startRunsForIssues(issueIds);
  }
});
