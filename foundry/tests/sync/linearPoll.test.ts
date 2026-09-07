import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

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

describe("LinearPollService.discoverPendingIssues", () => {
  it("warns and returns [] when no repos have linearProject or assigneeMe configured", async () => {
    const logger = makeLogger();
    const repoRegistry = { listRepos: vi.fn().mockReturnValue([makeRepoEntry()]) };
    const linearClient = { searchIssues: vi.fn() };
    const runRepo = { findActiveByIssueId: vi.fn() };
    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      {} as never,
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

  it("builds one search filter per repo with a linearProject or assigneeMe, and returns issues with no active run", async () => {
    const logger = makeLogger();
    const repoRegistry = {
      listRepos: vi.fn().mockReturnValue([
        makeRepoEntry({ name: "repo-a", linearProject: "Proj A" }),
        makeRepoEntry({ name: "repo-b", assigneeMe: true, linearTeam: "Team B" }),
        makeRepoEntry({ name: "repo-c" }),
      ]),
    };
    const issueA = makeIssue({ id: "a1" });
    const issueB = makeIssue({ id: "b1" });
    const linearClient = {
      searchIssues: vi
        .fn()
        .mockResolvedValueOnce([issueA])
        .mockResolvedValueOnce([issueB]),
    };
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      {} as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Proj A",
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
    expect(result.map((i) => i.id)).toEqual(["a1", "b1"]);
  });

  it("excludes issues that already have an active run", async () => {
    const logger = makeLogger();
    const repoRegistry = {
      listRepos: vi.fn().mockReturnValue([makeRepoEntry({ linearProject: "Proj A" })]),
    };
    const issue = makeIssue({ id: "has-run" });
    const linearClient = { searchIssues: vi.fn().mockResolvedValue([issue]) };
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue({ id: "existing-run" }) };
    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      {} as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
  });

  it("dedupes issues seen across multiple filters", async () => {
    const logger = makeLogger();
    const repoRegistry = {
      listRepos: vi.fn().mockReturnValue([
        makeRepoEntry({ name: "repo-a", linearProject: "Proj A" }),
        makeRepoEntry({ name: "repo-b", assigneeMe: true }),
      ]),
    };
    const sharedIssue = makeIssue({ id: "dup-1" });
    const linearClient = {
      searchIssues: vi.fn().mockResolvedValue([sharedIssue]),
    };
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      {} as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toHaveLength(1);
    // Only checked for an active run once even though it appeared in both filters.
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(1);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue with no existing active run", async () => {
    const logger = makeLogger();
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = { startRun: vi.fn().mockResolvedValue(undefined) };
    const svc = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["i1", "i2"]);

    expect(result).toEqual({ started: ["i1", "i2"], skipped: [] });
    expect(orchestrator.startRun).toHaveBeenCalledTimes(2);
  });

  it("skips an issue that already has an active run without calling startRun", async () => {
    const logger = makeLogger();
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue({ id: "existing" }) };
    const orchestrator = { startRun: vi.fn() };
    const svc = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["i1"]);

    expect(result).toEqual({ started: [], skipped: ["i1"] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("skips and logs an error when orchestrator.startRun throws", async () => {
    const logger = makeLogger();
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = { startRun: vi.fn().mockRejectedValue(new Error("boom")) };
    const svc = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["i1"]);

    expect(result).toEqual({ started: [], skipped: ["i1"] });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "i1", error: "boom" }),
      "Failed to start run for issue",
    );
  });

  it("handles a mix of started, skipped-existing, and failed issues", async () => {
    const logger = makeLogger();
    const runRepo = {
      findActiveByIssueId: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "existing" })
        .mockResolvedValueOnce(null),
    };
    const orchestrator = {
      startRun: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("fail")),
    };
    const svc = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["ok", "existing", "fails"]);

    expect(result.started).toEqual(["ok"]);
    expect(result.skipped).toEqual(["existing", "fails"]);
  });
});
