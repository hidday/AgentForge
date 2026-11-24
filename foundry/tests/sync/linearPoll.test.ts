import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

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

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeRepoEntry(overrides: Record<string, unknown> = {}) {
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

describe("LinearPollService.discoverPendingIssues", () => {
  it("warns and returns empty when no repos have a linearProject or assigneeMe configured", async () => {
    const repoRegistry = { listRepos: vi.fn().mockReturnValue([makeRepoEntry()]) };
    const logger = makeLogger();
    const svc = new LinearPollService(
      {} as never,
      {} as never,
      {} as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
  });

  it("builds one search filter per eligible repo and returns issues with no active run", async () => {
    const repoRegistry = {
      listRepos: vi.fn().mockReturnValue([
        makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
        makeRepoEntry({ name: "repo-b", assigneeMe: true, linearTeam: "Team B" }),
        makeRepoEntry({ name: "repo-c" }),
      ]),
    };
    const issueA = makeIssue({ id: "a1" });
    const issueB = makeIssue({ id: "b1" });
    const searchIssues = vi.fn().mockImplementation((filter: { projectName?: string }) =>
      filter.projectName === "Project A" ? Promise.resolve([issueA]) : Promise.resolve([issueB]),
    );
    const linearClient = { searchIssues };
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      {} as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(searchIssues).toHaveBeenCalledTimes(2);
    expect(result.map((i) => i.id).sort()).toEqual(["a1", "b1"]);
  });

  it("excludes issues that already have an active run", async () => {
    const repoRegistry = {
      listRepos: vi.fn().mockReturnValue([makeRepoEntry({ linearProject: "Project A" })]),
    };
    const linearClient = { searchIssues: vi.fn().mockResolvedValue([makeIssue({ id: "a1" })]) };
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue({ id: "run-1" }) };

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      {} as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
  });

  it("deduplicates issues seen across multiple filters", async () => {
    const repoRegistry = {
      listRepos: vi.fn().mockReturnValue([
        makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
        makeRepoEntry({ name: "repo-b", assigneeMe: true }),
      ]),
    };
    const sharedIssue = makeIssue({ id: "shared-1" });
    const linearClient = { searchIssues: vi.fn().mockResolvedValue([sharedIssue]) };
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      {} as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toHaveLength(1);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue with no active run", async () => {
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = { startRun: vi.fn().mockResolvedValue(undefined) };
    const svc = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      makeLogger() as never,
    );

    const result = await svc.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result.started).toEqual(["issue-1", "issue-2"]);
    expect(result.skipped).toEqual([]);
    expect(orchestrator.startRun).toHaveBeenCalledTimes(2);
  });

  it("skips an issue that already has an active run without starting a new one", async () => {
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue({ id: "run-1" }) };
    const orchestrator = { startRun: vi.fn() };
    const svc = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      makeLogger() as never,
    );

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result.skipped).toEqual(["issue-1"]);
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("skips an issue and logs an error when starting the run throws", async () => {
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = { startRun: vi.fn().mockRejectedValue(new Error("boom")) };
    const logger = makeLogger();
    const svc = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result.skipped).toEqual(["issue-1"]);
    expect(result.started).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "issue-1", error: "boom" }),
      "Failed to start run for issue",
    );
  });

  it("logs a summary count of started vs. skipped issues", async () => {
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = { startRun: vi.fn().mockResolvedValue(undefined) };
    const logger = makeLogger();
    const svc = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      logger as never,
    );

    await svc.startRunsForIssues(["issue-1"]);

    expect(logger.info).toHaveBeenCalledWith(
      { started: 1, skipped: 0 },
      "Ingested Linear issues",
    );
  });
});
