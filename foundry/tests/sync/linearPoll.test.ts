import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

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
    findActiveByIssueId: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };
}

function makeOrchestrator() {
  return { startRun: vi.fn() };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "/repos/a",
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

function makeRepoRegistry(repos: RepoEntry[]) {
  return { listRepos: vi.fn().mockReturnValue(repos) };
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Some issue",
    description: "",
    branchName: "ai/issue-1",
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
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    linearClient = makeLinearClient();
    runRepo = makeRunRepo();
    orchestrator = makeOrchestrator();
    logger = makeLogger();
  });

  function makeService(repos: RepoEntry[]) {
    const repoRegistry = makeRepoRegistry(repos);
    return new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );
  }

  describe("discoverPendingIssues", () => {
    it("returns an empty array and warns when no repos are configured for Linear discovery", async () => {
      const service = makeService([makeRepoEntry({ linearProject: undefined, assigneeMe: undefined })]);

      const result = await service.discoverPendingIssues();

      expect(result).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
      expect(linearClient.searchIssues).not.toHaveBeenCalled();
    });

    it("builds one filter per eligible repo (linearProject or assigneeMe) and merges candidates", async () => {
      const repos = [
        makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
        makeRepoEntry({ name: "repo-b", assigneeMe: true, linearTeam: "TEAM" }),
        makeRepoEntry({ name: "repo-c" }), // neither configured -> excluded
      ];
      const service = makeService(repos);

      linearClient.searchIssues
        .mockResolvedValueOnce([makeIssue({ id: "a1" })])
        .mockResolvedValueOnce([makeIssue({ id: "b1" })]);
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      const result = await service.discoverPendingIssues();

      expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
      expect(linearClient.searchIssues).toHaveBeenNthCalledWith(1, {
        projectName: "Project A",
        assigneeMe: undefined,
        team: undefined,
        state: "Todo",
      });
      expect(linearClient.searchIssues).toHaveBeenNthCalledWith(2, {
        projectName: undefined,
        assigneeMe: true,
        team: "TEAM",
        state: "Todo",
      });
      expect(result.map((i) => i.id)).toEqual(["a1", "b1"]);
      expect(logger.info).toHaveBeenCalled();
    });

    it("deduplicates issues seen across multiple filters", async () => {
      const repos = [
        makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
        makeRepoEntry({ name: "repo-b", linearProject: "Project B" }),
      ];
      const service = makeService(repos);

      linearClient.searchIssues
        .mockResolvedValueOnce([makeIssue({ id: "shared-1" })])
        .mockResolvedValueOnce([makeIssue({ id: "shared-1" }), makeIssue({ id: "unique-2" })]);
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      const result = await service.discoverPendingIssues();

      expect(result.map((i) => i.id)).toEqual(["shared-1", "unique-2"]);
    });

    it("excludes issues that already have an active run", async () => {
      const repos = [makeRepoEntry({ linearProject: "Project A" })];
      const service = makeService(repos);

      linearClient.searchIssues.mockResolvedValue([
        makeIssue({ id: "has-run" }),
        makeIssue({ id: "no-run" }),
      ]);
      runRepo.findActiveByIssueId.mockImplementation((id: string) =>
        Promise.resolve(id === "has-run" ? { id: "run-1" } : null),
      );

      const result = await service.discoverPendingIssues();

      expect(result.map((i) => i.id)).toEqual(["no-run"]);
    });
  });

  describe("startRunsForIssues", () => {
    it("starts runs for issues without an active run", async () => {
      const service = makeService([makeRepoEntry({ linearProject: "P" })]);
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      orchestrator.startRun.mockResolvedValue({ id: "run-1" });

      const result = await service.startRunsForIssues(["issue-1"]);

      expect(result).toEqual({ started: ["issue-1"], skipped: [] });
      expect(orchestrator.startRun).toHaveBeenCalledWith("issue-1");
    });

    it("skips issues that already have an active run without starting one", async () => {
      const service = makeService([makeRepoEntry({ linearProject: "P" })]);
      runRepo.findActiveByIssueId.mockResolvedValue({ id: "existing-run" });

      const result = await service.startRunsForIssues(["issue-1"]);

      expect(result).toEqual({ started: [], skipped: ["issue-1"] });
      expect(orchestrator.startRun).not.toHaveBeenCalled();
    });

    it("catches startRun errors, logs them, and marks the issue as skipped", async () => {
      const service = makeService([makeRepoEntry({ linearProject: "P" })]);
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      orchestrator.startRun.mockRejectedValue(new Error("boom"));

      const result = await service.startRunsForIssues(["issue-1"]);

      expect(result).toEqual({ started: [], skipped: ["issue-1"] });
      expect(logger.error).toHaveBeenCalledWith(
        { issueId: "issue-1", error: "boom" },
        "Failed to start run for issue",
      );
    });

    it("stringifies a non-Error thrown from startRun", async () => {
      const service = makeService([makeRepoEntry({ linearProject: "P" })]);
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      orchestrator.startRun.mockRejectedValue("plain string failure");

      const result = await service.startRunsForIssues(["issue-1"]);

      expect(result.skipped).toEqual(["issue-1"]);
      expect(logger.error).toHaveBeenCalledWith(
        { issueId: "issue-1", error: "plain string failure" },
        "Failed to start run for issue",
      );
    });

    it("handles a mix of started and skipped issues, logging the summary", async () => {
      const service = makeService([makeRepoEntry({ linearProject: "P" })]);
      runRepo.findActiveByIssueId.mockImplementation((id: string) =>
        Promise.resolve(id === "already-running" ? { id: "run-x" } : null),
      );
      orchestrator.startRun.mockResolvedValue({ id: "run-new" });

      const result = await service.startRunsForIssues(["new-1", "already-running"]);

      expect(result).toEqual({ started: ["new-1"], skipped: ["already-running"] });
      expect(logger.info).toHaveBeenCalledWith(
        { started: 1, skipped: 1 },
        "Ingested Linear issues",
      );
    });

    it("handles an empty issueIds list", async () => {
      const service = makeService([makeRepoEntry({ linearProject: "P" })]);

      const result = await service.startRunsForIssues([]);

      expect(result).toEqual({ started: [], skipped: [] });
      expect(orchestrator.startRun).not.toHaveBeenCalled();
    });
  });
});
