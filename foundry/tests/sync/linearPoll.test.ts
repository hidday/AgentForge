import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

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
    id: "iss-1",
    title: "Do the thing",
    description: "desc",
    branchName: "ai/iss-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns [] and logs a warning when no repo has linearProject or assigneeMe configured", async () => {
    const logger = makeLogger();
    const repoRegistry = {
      listRepos: vi.fn().mockReturnValue([makeRepoEntry()]),
    };
    const linearClient = { searchIssues: vi.fn() };
    const runRepo = { findActiveByIssueId: vi.fn() };
    const orchestrator = { startRun: vi.fn() };

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
  });

  it("builds one search filter per configured repo and returns candidates with no active run", async () => {
    const repos = [
      makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
      makeRepoEntry({ name: "repo-b", assigneeMe: true, linearTeam: "TeamB" }),
      makeRepoEntry({ name: "repo-c" }), // not configured for polling
    ];
    const repoRegistry = { listRepos: vi.fn().mockReturnValue(repos) };

    const issueA = makeIssue({ id: "a1" });
    const issueB = makeIssue({ id: "b1" });
    const linearClient = {
      searchIssues: vi
        .fn()
        .mockResolvedValueOnce([issueA])
        .mockResolvedValueOnce([issueB]),
    };
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = { startRun: vi.fn() };
    const logger = makeLogger();

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.discoverPendingIssues();

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
      team: "TeamB",
      state: "Todo",
    });
    expect(result.map((i) => i.id)).toEqual(["a1", "b1"]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ candidateCount: 2 }),
      "Discovered pending Linear issues",
    );
  });

  it("excludes issues that already have an active run", async () => {
    const repos = [makeRepoEntry({ name: "repo-a", linearProject: "Project A" })];
    const repoRegistry = { listRepos: vi.fn().mockReturnValue(repos) };

    const issue1 = makeIssue({ id: "i1" });
    const issue2 = makeIssue({ id: "i2" });
    const linearClient = { searchIssues: vi.fn().mockResolvedValue([issue1, issue2]) };
    const runRepo = {
      findActiveByIssueId: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(id === "i1" ? { id: "run-x" } : null),
      ),
    };
    const orchestrator = { startRun: vi.fn() };

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["i2"]);
  });

  it("deduplicates issues that appear in more than one filter's results", async () => {
    const repos = [
      makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
      makeRepoEntry({ name: "repo-b", linearProject: "Project B" }),
    ];
    const repoRegistry = { listRepos: vi.fn().mockReturnValue(repos) };

    const sharedIssue = makeIssue({ id: "dup-1" });
    const linearClient = {
      searchIssues: vi
        .fn()
        .mockResolvedValueOnce([sharedIssue])
        .mockResolvedValueOnce([sharedIssue]),
    };
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = { startRun: vi.fn() };

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("dup-1");
    // findActiveByIssueId should only be checked once for the deduplicated issue
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(1);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts runs for issues with no active run and reports them as started", async () => {
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = { startRun: vi.fn().mockResolvedValue({ id: "run-1" }) };
    const logger = makeLogger();

    const svc = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["i1", "i2"]);

    expect(result.started).toEqual(["i1", "i2"]);
    expect(result.skipped).toEqual([]);
    expect(orchestrator.startRun).toHaveBeenCalledWith("i1");
    expect(orchestrator.startRun).toHaveBeenCalledWith("i2");
    expect(logger.info).toHaveBeenCalledWith(
      { started: 2, skipped: 0 },
      "Ingested Linear issues",
    );
  });

  it("skips issues that already have an active run without starting a new one", async () => {
    const runRepo = {
      findActiveByIssueId: vi
        .fn()
        .mockResolvedValueOnce({ id: "existing-run" })
        .mockResolvedValueOnce(null),
    };
    const orchestrator = { startRun: vi.fn().mockResolvedValue({ id: "run-2" }) };

    const svc = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      makeLogger() as never,
    );

    const result = await svc.startRunsForIssues(["already-running", "fresh"]);

    expect(result.skipped).toEqual(["already-running"]);
    expect(result.started).toEqual(["fresh"]);
    expect(orchestrator.startRun).toHaveBeenCalledTimes(1);
    expect(orchestrator.startRun).toHaveBeenCalledWith("fresh");
  });

  it("catches errors from orchestrator.startRun, logs them, and marks the issue skipped", async () => {
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const error = new Error("boom");
    const orchestrator = { startRun: vi.fn().mockRejectedValue(error) };
    const logger = makeLogger();

    const svc = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["failing-issue"]);

    expect(result.skipped).toEqual(["failing-issue"]);
    expect(result.started).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "failing-issue", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error thrown value in the error log", async () => {
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = { startRun: vi.fn().mockRejectedValue("plain string failure") };
    const logger = makeLogger();

    const svc = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      logger as never,
    );

    await svc.startRunsForIssues(["weird-issue"]);

    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "weird-issue", error: "plain string failure" },
      "Failed to start run for issue",
    );
  });

  it("returns empty started/skipped for an empty issue id list", async () => {
    const runRepo = { findActiveByIssueId: vi.fn() };
    const orchestrator = { startRun: vi.fn() };

    const svc = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      makeLogger() as never,
    );

    const result = await svc.startRunsForIssues([]);

    expect(result).toEqual({ started: [], skipped: [] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });
});
