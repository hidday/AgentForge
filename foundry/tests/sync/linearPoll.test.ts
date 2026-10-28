import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  child: () => noopLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "repo-a",
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
    id: "LIN-1",
    title: "Issue",
    description: "",
    branchName: "ai/lin-1",
    state: "Todo",
    labels: [],
    priority: 1,
    ...overrides,
  };
}

describe("LinearPollService", () => {
  let linearClient: { searchIssues: ReturnType<typeof vi.fn> };
  let runRepo: { findActiveByIssueId: ReturnType<typeof vi.fn> };
  let orchestrator: { startRun: ReturnType<typeof vi.fn> };
  let repoRegistry: { listRepos: ReturnType<typeof vi.fn> };
  let service: LinearPollService;

  beforeEach(() => {
    linearClient = { searchIssues: vi.fn() };
    runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    orchestrator = { startRun: vi.fn() };
    repoRegistry = { listRepos: vi.fn() };
    service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      noopLogger,
    );
  });

  describe("discoverPendingIssues", () => {
    it("returns an empty list and warns when no repo is configured for polling", async () => {
      repoRegistry.listRepos.mockReturnValue([makeRepoEntry()]);

      const result = await service.discoverPendingIssues();

      expect(result).toEqual([]);
      expect(noopLogger.warn).toHaveBeenCalled();
      expect(linearClient.searchIssues).not.toHaveBeenCalled();
    });

    it("builds a filter per repo with a linearProject or assigneeMe configured", async () => {
      repoRegistry.listRepos.mockReturnValue([
        makeRepoEntry({ name: "a", linearProject: "Project A" }),
        makeRepoEntry({ name: "b", assigneeMe: true, linearTeam: "Team B" }),
        makeRepoEntry({ name: "c" }),
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
        team: "Team B",
        state: "Todo",
      });
    });

    it("excludes issues that already have an active run", async () => {
      repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ linearProject: "Project A" })]);
      linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "LIN-1" }), makeIssue({ id: "LIN-2" })]);
      runRepo.findActiveByIssueId.mockImplementation((id: string) =>
        Promise.resolve(id === "LIN-1" ? { id: "run-1" } : null),
      );

      const result = await service.discoverPendingIssues();

      expect(result.map((i) => i.id)).toEqual(["LIN-2"]);
    });

    it("de-duplicates issues seen across multiple filters", async () => {
      repoRegistry.listRepos.mockReturnValue([
        makeRepoEntry({ name: "a", linearProject: "Project A" }),
        makeRepoEntry({ name: "b", assigneeMe: true }),
      ]);
      linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "LIN-1" })]);

      const result = await service.discoverPendingIssues();

      expect(result).toHaveLength(1);
    });
  });

  describe("startRunsForIssues", () => {
    it("starts a run for each issue without an active run", async () => {
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      orchestrator.startRun.mockResolvedValue(undefined);

      const result = await service.startRunsForIssues(["LIN-1", "LIN-2"]);

      expect(result).toEqual({ started: ["LIN-1", "LIN-2"], skipped: [] });
      expect(orchestrator.startRun).toHaveBeenCalledTimes(2);
    });

    it("skips an issue that already has an active run", async () => {
      runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-1" });

      const result = await service.startRunsForIssues(["LIN-1"]);

      expect(result).toEqual({ started: [], skipped: ["LIN-1"] });
      expect(orchestrator.startRun).not.toHaveBeenCalled();
    });

    it("skips and logs an issue when starting the run throws", async () => {
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      orchestrator.startRun.mockRejectedValue(new Error("boom"));

      const result = await service.startRunsForIssues(["LIN-1"]);

      expect(result).toEqual({ started: [], skipped: ["LIN-1"] });
      expect(noopLogger.error).toHaveBeenCalled();
    });

    it("handles a mix of started and skipped issues", async () => {
      runRepo.findActiveByIssueId.mockImplementation((id: string) =>
        Promise.resolve(id === "LIN-2" ? { id: "run-1" } : null),
      );
      orchestrator.startRun.mockResolvedValue(undefined);

      const result = await service.startRunsForIssues(["LIN-1", "LIN-2"]);

      expect(result).toEqual({ started: ["LIN-1"], skipped: ["LIN-2"] });
    });
  });
});
