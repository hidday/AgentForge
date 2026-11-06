import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "/repos/a",
    defaultBranch: "main",
    allowedPaths: ["src/**"],
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

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Issue",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeDeps(repos: RepoEntry[]) {
  const linearClient = { searchIssues: vi.fn().mockResolvedValue([]) };
  const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
  const orchestrator = { startRun: vi.fn().mockResolvedValue({ id: "run-1" }) };
  const repoRegistry = { listRepos: vi.fn().mockReturnValue(repos) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const service = new LinearPollService(
    linearClient as never,
    runRepo as never,
    orchestrator as never,
    repoRegistry as never,
    logger as never,
  );

  return { service, linearClient, runRepo, orchestrator, repoRegistry, logger };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns an empty array and warns when no repos are configured for Linear polling", async () => {
    const { service, logger, linearClient } = makeDeps([makeRepoEntry()]);

    const issues = await service.discoverPendingIssues();

    expect(issues).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds a filter per configured repo and searches each one", async () => {
    const repos = [
      makeRepoEntry({ name: "a", linearProject: "Alpha" }),
      makeRepoEntry({ name: "b", assigneeMe: true, linearTeam: "PRY" }),
      makeRepoEntry({ name: "c" }), // not eligible, no linearProject/assigneeMe
    ];
    const { service, linearClient } = makeDeps(repos);
    linearClient.searchIssues.mockResolvedValue([]);

    await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Alpha",
      assigneeMe: undefined,
      team: undefined,
      state: "Todo",
    });
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: undefined,
      assigneeMe: true,
      team: "PRY",
      state: "Todo",
    });
  });

  it("includes issues that have no active run", async () => {
    const repos = [makeRepoEntry({ linearProject: "Alpha" })];
    const { service, linearClient, runRepo } = makeDeps(repos);
    linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "issue-1" })]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const issues = await service.discoverPendingIssues();

    expect(issues).toEqual([makeIssue({ id: "issue-1" })]);
  });

  it("excludes issues that already have an active run", async () => {
    const repos = [makeRepoEntry({ linearProject: "Alpha" })];
    const { service, linearClient, runRepo } = makeDeps(repos);
    linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "issue-1" })]);
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-1" });

    const issues = await service.discoverPendingIssues();

    expect(issues).toEqual([]);
  });

  it("de-duplicates an issue returned by more than one filter", async () => {
    const repos = [
      makeRepoEntry({ name: "a", linearProject: "Alpha" }),
      makeRepoEntry({ name: "b", assigneeMe: true }),
    ];
    const { service, linearClient, runRepo } = makeDeps(repos);
    const sharedIssue = makeIssue({ id: "issue-1" });
    linearClient.searchIssues.mockResolvedValue([sharedIssue]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const issues = await service.discoverPendingIssues();

    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe("issue-1");
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue id with no active run", async () => {
    const { service, orchestrator, runRepo } = makeDeps([]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const result = await service.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result.started).toEqual(["issue-1", "issue-2"]);
    expect(result.skipped).toEqual([]);
    expect(orchestrator.startRun).toHaveBeenCalledTimes(2);
  });

  it("skips an issue id that already has an active run", async () => {
    const { service, orchestrator, runRepo } = makeDeps([]);
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "existing-run" });

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result.started).toEqual([]);
    expect(result.skipped).toEqual(["issue-1"]);
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("skips and logs an error when orchestrator.startRun throws an Error", async () => {
    const { service, orchestrator, runRepo, logger } = makeDeps([]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValue(new Error("boom"));

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result.started).toEqual([]);
    expect(result.skipped).toEqual(["issue-1"]);
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error rejection when logging the failure", async () => {
    const { service, orchestrator, runRepo, logger } = makeDeps([]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValue("not-an-error");

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result.skipped).toEqual(["issue-1"]);
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "not-an-error" },
      "Failed to start run for issue",
    );
  });

  it("handles an empty issueIds list", async () => {
    const { service, orchestrator } = makeDeps([]);

    const result = await service.startRunsForIssues([]);

    expect(result).toEqual({ started: [], skipped: [] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });
});
