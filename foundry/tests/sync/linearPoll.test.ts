import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeIssue(id: string): LinearIssue {
  return {
    id,
    title: `Issue ${id}`,
    description: "",
    branchName: `ai/${id}`,
    state: "Todo",
    labels: [],
    priority: 0,
  };
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
      maxFilesChanged: 50,
      maxDiffLines: 1000,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    ...overrides,
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("warns and returns no candidates when no repos are configured for polling", async () => {
    const linearClient = { searchIssues: vi.fn() };
    const runRepo = { findActiveByIssueId: vi.fn() };
    const orchestrator = { startRun: vi.fn() };
    const repoRegistry = { listRepos: vi.fn().mockReturnValue([makeRepoEntry()]) };
    const logger = makeLogger();

    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds one filter per configured repo and returns new candidates", async () => {
    const linearClient = {
      searchIssues: vi
        .fn()
        .mockResolvedValueOnce([makeIssue("a"), makeIssue("b")])
        .mockResolvedValueOnce([makeIssue("c")]),
    };
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = { startRun: vi.fn() };
    const repoRegistry = {
      listRepos: vi.fn().mockReturnValue([
        makeRepoEntry({ name: "repo-a", linearProject: "Alpha" }),
        makeRepoEntry({ name: "repo-b", assigneeMe: true, linearTeam: "ENG" }),
        makeRepoEntry({ name: "repo-c" }),
      ]),
    };

    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenNthCalledWith(1, {
      projectName: "Alpha",
      assigneeMe: undefined,
      team: undefined,
      state: "Todo",
    });
    expect(linearClient.searchIssues).toHaveBeenNthCalledWith(2, {
      projectName: undefined,
      assigneeMe: true,
      team: "ENG",
      state: "Todo",
    });
    expect(result.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("excludes issues that already have an active run", async () => {
    const linearClient = { searchIssues: vi.fn().mockResolvedValue([makeIssue("a"), makeIssue("b")]) };
    const runRepo = {
      findActiveByIssueId: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(id === "a" ? { id: "run-1" } : null),
      ),
    };
    const orchestrator = { startRun: vi.fn() };
    const repoRegistry = { listRepos: vi.fn().mockReturnValue([makeRepoEntry({ assigneeMe: true })]) };

    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["b"]);
  });

  it("deduplicates issues seen across multiple repo filters", async () => {
    const linearClient = {
      searchIssues: vi
        .fn()
        .mockResolvedValueOnce([makeIssue("a")])
        .mockResolvedValueOnce([makeIssue("a")]),
    };
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = { startRun: vi.fn() };
    const repoRegistry = {
      listRepos: vi.fn().mockReturnValue([
        makeRepoEntry({ name: "repo-a", linearProject: "Alpha" }),
        makeRepoEntry({ name: "repo-b", linearProject: "Beta" }),
      ]),
    };

    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["a"]);
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(1);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue without an existing active run", async () => {
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = { startRun: vi.fn().mockResolvedValue(undefined) };

    const service = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      makeLogger() as never,
    );

    const result = await service.startRunsForIssues(["a", "b"]);

    expect(result).toEqual({ started: ["a", "b"], skipped: [] });
    expect(orchestrator.startRun).toHaveBeenCalledTimes(2);
  });

  it("skips issues that already have an active run without starting a new one", async () => {
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue({ id: "run-1" }) };
    const orchestrator = { startRun: vi.fn() };

    const service = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      makeLogger() as never,
    );

    const result = await service.startRunsForIssues(["a"]);

    expect(result).toEqual({ started: [], skipped: ["a"] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("skips an issue and logs an error when starting the run throws", async () => {
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = { startRun: vi.fn().mockRejectedValue(new Error("boom")) };
    const logger = makeLogger();

    const service = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      logger as never,
    );

    const result = await service.startRunsForIssues(["a"]);

    expect(result).toEqual({ started: [], skipped: ["a"] });
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "a", error: "boom" },
      "Failed to start run for issue",
    );
  });
});
