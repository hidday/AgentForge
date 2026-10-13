import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeLinearClient() {
  return {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn(),
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
    findActiveByIssueId: vi.fn(),
    updateState: vi.fn(),
    findRunsNeedingLinearBackfill: vi.fn(),
    update: vi.fn(),
  };
}

function makeOrchestrator() {
  return {
    startRun: vi.fn(),
  };
}

function makeRepoRegistry() {
  return {
    listRepos: vi.fn(),
    getRepoByName: vi.fn(),
    getRepoByLinearProject: vi.fn(),
    getDefaultRepo: vi.fn(),
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "/repos/repo-a",
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

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Fix the bug",
    description: "desc",
    branchName: "ai/eng-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("LinearPollService", () => {
  let linearClient: ReturnType<typeof makeLinearClient>;
  let runRepo: ReturnType<typeof makeRunRepo>;
  let orchestrator: ReturnType<typeof makeOrchestrator>;
  let repoRegistry: ReturnType<typeof makeRepoRegistry>;
  let logger: ReturnType<typeof makeLogger>;
  let service: LinearPollService;

  beforeEach(() => {
    linearClient = makeLinearClient();
    runRepo = makeRunRepo();
    orchestrator = makeOrchestrator();
    repoRegistry = makeRepoRegistry();
    logger = makeLogger();
    service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );
  });

  describe("discoverPendingIssues", () => {
    it("returns an empty list and warns when no repos are configured for polling", async () => {
      repoRegistry.listRepos.mockReturnValue([
        makeRepoEntry({ name: "repo-a", linearProject: undefined, assigneeMe: undefined }),
      ]);

      const result = await service.discoverPendingIssues();

      expect(result).toEqual([]);
      expect(linearClient.searchIssues).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        "No Linear projects or assigneeMe repos configured in repo registry",
      );
    });

    it("builds one filter per configured repo and returns new candidate issues", async () => {
      repoRegistry.listRepos.mockReturnValue([
        makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
        makeRepoEntry({ name: "repo-b", assigneeMe: true, linearTeam: "ENG" }),
        makeRepoEntry({ name: "repo-c" }),
      ]);

      const issueA = makeIssue({ id: "issue-a" });
      const issueB = makeIssue({ id: "issue-b" });

      linearClient.searchIssues.mockImplementation((filter: { projectName?: string }) => {
        if (filter.projectName === "Project A") return Promise.resolve([issueA]);
        return Promise.resolve([issueB]);
      });
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      const result = await service.discoverPendingIssues();

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

      expect(result.map((i) => i.id)).toEqual(["issue-a", "issue-b"]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ candidateCount: 2 }),
        "Discovered pending Linear issues",
      );
    });

    it("excludes issues that already have an active run", async () => {
      repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ linearProject: "Project A" })]);
      const issue = makeIssue({ id: "issue-a" });
      linearClient.searchIssues.mockResolvedValue([issue]);
      runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-existing" });

      const result = await service.discoverPendingIssues();

      expect(result).toEqual([]);
    });

    it("de-duplicates an issue returned by more than one filter", async () => {
      repoRegistry.listRepos.mockReturnValue([
        makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
        makeRepoEntry({ name: "repo-b", assigneeMe: true }),
      ]);
      const sharedIssue = makeIssue({ id: "shared-issue" });
      linearClient.searchIssues.mockResolvedValue([sharedIssue]);
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      const result = await service.discoverPendingIssues();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("shared-issue");
      expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(1);
    });
  });

  describe("startRunsForIssues", () => {
    it("starts a run for each new issue and reports it as started", async () => {
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      orchestrator.startRun.mockResolvedValue({ id: "run-1" });

      const result = await service.startRunsForIssues(["issue-1", "issue-2"]);

      expect(orchestrator.startRun).toHaveBeenCalledWith("issue-1");
      expect(orchestrator.startRun).toHaveBeenCalledWith("issue-2");
      expect(result).toEqual({ started: ["issue-1", "issue-2"], skipped: [] });
      expect(logger.info).toHaveBeenCalledWith(
        { started: 2, skipped: 0 },
        "Ingested Linear issues",
      );
    });

    it("skips an issue that already has an active run without starting a new one", async () => {
      runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-existing" });

      const result = await service.startRunsForIssues(["issue-1"]);

      expect(orchestrator.startRun).not.toHaveBeenCalled();
      expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    });

    it("catches an error from orchestrator.startRun, logs it, and marks the issue skipped instead of throwing", async () => {
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      orchestrator.startRun.mockRejectedValue(new Error("boom"));

      const result = await service.startRunsForIssues(["issue-1"]);

      expect(result).toEqual({ started: [], skipped: ["issue-1"] });
      expect(logger.error).toHaveBeenCalledWith(
        { issueId: "issue-1", error: "boom" },
        "Failed to start run for issue",
      );
    });

    it("handles a non-Error thrown value by stringifying it in the log", async () => {
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      orchestrator.startRun.mockRejectedValue("plain string failure");

      const result = await service.startRunsForIssues(["issue-1"]);

      expect(result).toEqual({ started: [], skipped: ["issue-1"] });
      expect(logger.error).toHaveBeenCalledWith(
        { issueId: "issue-1", error: "plain string failure" },
        "Failed to start run for issue",
      );
    });

    it("continues processing remaining issues after one fails", async () => {
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      orchestrator.startRun
        .mockRejectedValueOnce(new Error("first fails"))
        .mockResolvedValueOnce({ id: "run-2" });

      const result = await service.startRunsForIssues(["issue-1", "issue-2"]);

      expect(result).toEqual({ started: ["issue-2"], skipped: ["issue-1"] });
    });

    it("returns empty started/skipped for an empty input list", async () => {
      const result = await service.startRunsForIssues([]);

      expect(result).toEqual({ started: [], skipped: [] });
      expect(orchestrator.startRun).not.toHaveBeenCalled();
    });
  });
});
