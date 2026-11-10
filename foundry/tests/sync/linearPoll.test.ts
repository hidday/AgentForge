import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
    title: "Issue",
    description: "",
    branchName: `ai/${overrides.id}`,
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeLinearClient() {
  return { searchIssues: vi.fn() };
}

function makeRunRepo() {
  return { findActiveByIssueId: vi.fn() };
}

function makeOrchestrator() {
  return { startRun: vi.fn() };
}

function makeRepoRegistry(repos: Array<Record<string, unknown>>) {
  return { listRepos: vi.fn().mockReturnValue(repos) };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("LinearPollService.discoverPendingIssues", () => {
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

  function makeService(repos: Array<Record<string, unknown>>) {
    const repoRegistry = makeRepoRegistry(repos);
    return new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );
  }

  it("warns and returns an empty array when no repos are configured for polling", async () => {
    const service = makeService([{ name: "repo-a" }]);

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds a filter per eligible repo and returns new, non-duplicate candidates", async () => {
    const service = makeService([
      { name: "repo-a", linearProject: "Project A" },
      { name: "repo-b", assigneeMe: true, linearTeam: "PRY" },
      { name: "repo-c" },
    ]);

    linearClient.searchIssues
      .mockResolvedValueOnce([makeIssue({ id: "issue-1" }), makeIssue({ id: "issue-2" })])
      .mockResolvedValueOnce([makeIssue({ id: "issue-2" }), makeIssue({ id: "issue-3" })]);
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
      team: "PRY",
      state: "Todo",
    });
    // issue-2 appears in both filters' results but must only be counted once.
    expect(result.map((i) => i.id).sort()).toEqual(["issue-1", "issue-2", "issue-3"]);
  });

  it("excludes issues that already have an active run", async () => {
    const service = makeService([{ name: "repo-a", linearProject: "Project A" }]);
    linearClient.searchIssues.mockResolvedValue([
      makeIssue({ id: "issue-1" }),
      makeIssue({ id: "issue-2" }),
    ]);
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "issue-1" ? { id: "run-1" } : null),
    );

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["issue-2"]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  let linearClient: ReturnType<typeof makeLinearClient>;
  let runRepo: ReturnType<typeof makeRunRepo>;
  let orchestrator: ReturnType<typeof makeOrchestrator>;
  let logger: ReturnType<typeof makeLogger>;
  let service: LinearPollService;

  beforeEach(() => {
    linearClient = makeLinearClient();
    runRepo = makeRunRepo();
    orchestrator = makeOrchestrator();
    logger = makeLogger();
    const repoRegistry = makeRepoRegistry([]);
    service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );
  });

  it("starts a run for a new issue and skips one that already has an active run", async () => {
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "issue-existing" ? { id: "run-1" } : null),
    );
    orchestrator.startRun.mockResolvedValue({ id: "run-new" });

    const result = await service.startRunsForIssues(["issue-new", "issue-existing"]);

    expect(result.started).toEqual(["issue-new"]);
    expect(result.skipped).toEqual(["issue-existing"]);
    expect(orchestrator.startRun).toHaveBeenCalledTimes(1);
    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-new");
  });

  it("skips and logs an issue whose startRun call throws, without failing the whole batch", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ id: "run-2" });

    const result = await service.startRunsForIssues(["issue-fail", "issue-ok"]);

    expect(result.skipped).toEqual(["issue-fail"]);
    expect(result.started).toEqual(["issue-ok"]);
    expect(logger.error).toHaveBeenCalled();
  });

  it("logs a non-Error rejection from startRun using String()", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValueOnce("plain string failure");

    const result = await service.startRunsForIssues(["issue-fail"]);

    expect(result.skipped).toEqual(["issue-fail"]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "issue-fail", error: "plain string failure" }),
      expect.any(String),
    );
  });

  it("returns empty started/skipped for an empty input list", async () => {
    const result = await service.startRunsForIssues([]);
    expect(result).toEqual({ started: [], skipped: [] });
    expect(logger.info).toHaveBeenCalled();
  });
});
