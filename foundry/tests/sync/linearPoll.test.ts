import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
    identifier: "PRY-1",
    title: "Issue title",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
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

function makeDeps() {
  const linearClient = { searchIssues: vi.fn() };
  const runRepo = { findActiveByIssueId: vi.fn() };
  const orchestrator = { startRun: vi.fn() };
  const repoRegistry = { listRepos: vi.fn() };
  const logger = makeLogger();

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
  it("returns an empty array and warns when no repos are configured for polling", async () => {
    const { service, repoRegistry, logger } = makeDeps();
    repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ linearProject: undefined, assigneeMe: undefined })]);

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
  });

  it("builds a search filter per eligible repo and returns candidates without an active run", async () => {
    const { service, repoRegistry, linearClient, runRepo } = makeDeps();
    repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
      makeRepoEntry({ name: "repo-b", assigneeMe: true, linearTeam: "PRY" }),
    ]);
    linearClient.searchIssues.mockImplementation((filter: { projectName?: string }) =>
      Promise.resolve(
        filter.projectName === "Project A"
          ? [makeIssue({ id: "issue-a" })]
          : [makeIssue({ id: "issue-b" })],
      ),
    );
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const result = await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Project A",
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
    expect(result.map((i) => i.id)).toEqual(["issue-a", "issue-b"]);
  });

  it("excludes issues that already have an active run", async () => {
    const { service, repoRegistry, linearClient, runRepo } = makeDeps();
    repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ linearProject: "Project A" })]);
    linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "issue-a" })]);
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-1" });

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
  });

  it("de-duplicates issues seen across multiple filters", async () => {
    const { service, repoRegistry, linearClient, runRepo } = makeDeps();
    repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
      makeRepoEntry({ name: "repo-b", linearProject: "Project B" }),
    ]);
    linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "shared-issue" })]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const result = await service.discoverPendingIssues();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("shared-issue");
  });

  it("only includes repos with a linearProject or assigneeMe=true", async () => {
    const { service, repoRegistry, linearClient } = makeDeps();
    repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "repo-a" }), // neither set -- excluded
      makeRepoEntry({ name: "repo-b", assigneeMe: false }), // explicit false -- excluded
    ]);
    linearClient.searchIssues.mockResolvedValue([]);

    const result = await service.discoverPendingIssues();

    expect(linearClient.searchIssues).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue with no existing active run", async () => {
    const { service, runRepo, orchestrator } = makeDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockResolvedValue({ id: "run-1" });

    const result = await service.startRunsForIssues(["issue-a", "issue-b"]);

    expect(result.started).toEqual(["issue-a", "issue-b"]);
    expect(result.skipped).toEqual([]);
    expect(orchestrator.startRun).toHaveBeenCalledTimes(2);
  });

  it("skips issues that already have an active run without calling startRun", async () => {
    const { service, runRepo, orchestrator } = makeDeps();
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-existing" });

    const result = await service.startRunsForIssues(["issue-a"]);

    expect(result.skipped).toEqual(["issue-a"]);
    expect(result.started).toEqual([]);
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("skips and logs an error when orchestrator.startRun throws", async () => {
    const { service, runRepo, orchestrator, logger } = makeDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValue(new Error("planner unavailable"));

    const result = await service.startRunsForIssues(["issue-a"]);

    expect(result.skipped).toEqual(["issue-a"]);
    expect(result.started).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-a", error: "planner unavailable" },
      "Failed to start run for issue",
    );
  });

  it("handles a mix of started and skipped issues independently", async () => {
    const { service, runRepo, orchestrator } = makeDeps();
    runRepo.findActiveByIssueId.mockImplementation((issueId: string) =>
      Promise.resolve(issueId === "issue-existing" ? { id: "run-1" } : null),
    );
    orchestrator.startRun.mockImplementation((issueId: string) =>
      issueId === "issue-fails"
        ? Promise.reject(new Error("boom"))
        : Promise.resolve({ id: "run-new" }),
    );

    const result = await service.startRunsForIssues(["issue-existing", "issue-fails", "issue-ok"]);

    expect(result.skipped.sort()).toEqual(["issue-existing", "issue-fails"].sort());
    expect(result.started).toEqual(["issue-ok"]);
  });

  it("returns empty started/skipped for an empty input list", async () => {
    const { service, orchestrator } = makeDeps();

    const result = await service.startRunsForIssues([]);

    expect(result).toEqual({ started: [], skipped: [] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });
});
