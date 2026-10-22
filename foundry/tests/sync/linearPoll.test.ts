import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Fix bug",
    description: "desc",
    branchName: "ai/eng-1",
    state: "Todo",
    labels: [],
    priority: 1,
    ...overrides,
  };
}

function makeDeps() {
  const linearClient = { searchIssues: vi.fn() };
  const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
  const orchestrator = { startRun: vi.fn().mockResolvedValue(undefined) };
  const repoRegistry = { listRepos: vi.fn().mockReturnValue([]) };
  const logger = makeLogger();
  const svc = new LinearPollService(
    linearClient as never,
    runRepo as never,
    orchestrator as never,
    repoRegistry as never,
    logger as never,
  );
  return { svc, linearClient, runRepo, orchestrator, repoRegistry, logger };
}

describe("LinearPollService.discoverPendingIssues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty array and logs a warning when no repo has linearProject or assigneeMe configured", async () => {
    const { svc, repoRegistry, linearClient, logger } = makeDeps();
    repoRegistry.listRepos.mockReturnValue([{ name: "repo-a", directory: "/a" }]);

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("builds one search filter per eligible repo and returns deduped candidates with no active run", async () => {
    const { svc, repoRegistry, linearClient, runRepo } = makeDeps();
    repoRegistry.listRepos.mockReturnValue([
      { name: "repo-a", directory: "/a", linearProject: "Platform" },
      { name: "repo-b", directory: "/b", assigneeMe: true, linearTeam: "ENG" },
      { name: "repo-c", directory: "/c" },
    ]);
    linearClient.searchIssues
      .mockResolvedValueOnce([makeIssue({ id: "issue-1" })])
      .mockResolvedValueOnce([makeIssue({ id: "issue-2" })]);

    const result = await svc.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenNthCalledWith(1, {
      projectName: "Platform",
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
    expect(result.map((i) => i.id)).toEqual(["issue-1", "issue-2"]);
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(2);
  });

  it("deduplicates issues returned by multiple filters and excludes issues with an active run", async () => {
    const { svc, repoRegistry, linearClient, runRepo } = makeDeps();
    repoRegistry.listRepos.mockReturnValue([
      { name: "repo-a", directory: "/a", linearProject: "Platform" },
      { name: "repo-b", directory: "/b", linearProject: "Infra" },
    ]);
    linearClient.searchIssues
      .mockResolvedValueOnce([makeIssue({ id: "issue-1" }), makeIssue({ id: "issue-2" })])
      .mockResolvedValueOnce([makeIssue({ id: "issue-1" })]);
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "issue-2" ? { id: "run-x" } : null),
    );

    const result = await svc.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["issue-1"]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts a run for each issue id and reports it as started", async () => {
    const { svc, orchestrator } = makeDeps();

    const result = await svc.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result).toEqual({ started: ["issue-1", "issue-2"], skipped: [] });
    expect(orchestrator.startRun).toHaveBeenCalledTimes(2);
  });

  it("skips an issue that already has an active run without starting it", async () => {
    const { svc, runRepo, orchestrator } = makeDeps();
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "issue-1" ? { id: "run-x" } : null),
    );

    const result = await svc.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result).toEqual({ started: ["issue-2"], skipped: ["issue-1"] });
    expect(orchestrator.startRun).toHaveBeenCalledTimes(1);
    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-2");
  });

  it("skips an issue whose startRun call throws, logging the error, without failing the batch", async () => {
    const { svc, orchestrator, logger } = makeDeps();
    orchestrator.startRun.mockImplementation((id: string) =>
      id === "issue-1" ? Promise.reject(new Error("boom")) : Promise.resolve(undefined),
    );

    const result = await svc.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result).toEqual({ started: ["issue-2"], skipped: ["issue-1"] });
    expect(logger.error).toHaveBeenCalled();
  });
});
