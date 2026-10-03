import { describe, it, expect, vi } from "vitest";
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
  return { findActiveByIssueId: vi.fn() };
}

function makeOrchestrator() {
  return { startRun: vi.fn() };
}

function makeRepoRegistry(repos: Partial<RepoEntry>[]) {
  return { listRepos: vi.fn().mockReturnValue(repos) };
}

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
    id: overrides.id,
    title: "Issue",
    description: "",
    branchName: `ai/${overrides.id}`,
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns an empty array and warns when no repos are configured with linearProject or assigneeMe", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([{ name: "repo-1" }]);
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds one search filter per configured repo and returns candidates with no active run", async () => {
    const linearClient = makeLinearClient();
    linearClient.searchIssues.mockResolvedValueOnce([makeIssue({ id: "a" })]);
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([
      { name: "repo-1", linearProject: "Project A", linearTeam: "PRY" },
    ]);
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Project A",
      assigneeMe: undefined,
      team: "PRY",
      state: "Todo",
    });
    expect(result.map((i) => i.id)).toEqual(["a"]);
  });

  it("excludes an issue that already has an active run", async () => {
    const linearClient = makeLinearClient();
    linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "a" }), makeIssue({ id: "b" })]);
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "a" ? { id: "run-1" } : null),
    );
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([{ name: "repo-1", assigneeMe: true }]);
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

  it("de-duplicates an issue that matches multiple repo filters, only calling findActiveByIssueId once", async () => {
    const linearClient = makeLinearClient();
    linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "shared" })]);
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([
      { name: "repo-1", linearProject: "Project A" },
      { name: "repo-2", assigneeMe: true },
    ]);
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(1);
  });

  it("ignores repos with neither linearProject nor assigneeMe when building filters", async () => {
    const linearClient = makeLinearClient();
    linearClient.searchIssues.mockResolvedValue([]);
    const runRepo = makeRunRepo();
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([
      { name: "repo-1" },
      { name: "repo-2", linearProject: "Project A" },
    ]);
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(1);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue with no active run and reports it as started", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    orchestrator.startRun.mockResolvedValue({ id: "run-1" });
    const repoRegistry = makeRepoRegistry([]);
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: ["issue-1"], skipped: [] });
    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-1");
  });

  it("skips an issue that already has an active run without calling startRun", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-1" });
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([]);
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("catches an error from orchestrator.startRun and records the issue as skipped", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    orchestrator.startRun.mockRejectedValue(new Error("boom"));
    const repoRegistry = makeRepoRegistry([]);
    const logger = makeLogger();
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("processes a mix of started, skipped, and errored issues independently", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "already-running" ? { id: "run-x" } : null),
    );
    const orchestrator = makeOrchestrator();
    orchestrator.startRun.mockImplementation((id: string) =>
      id === "fails-to-start" ? Promise.reject(new Error("fail")) : Promise.resolve({ id: "run" }),
    );
    const repoRegistry = makeRepoRegistry([]);
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await service.startRunsForIssues([
      "starts-fine",
      "already-running",
      "fails-to-start",
    ]);

    expect(result.started).toEqual(["starts-fine"]);
    expect(result.skipped).toEqual(["already-running", "fails-to-start"]);
  });

  it("handles a non-Error rejection by stringifying it in the log", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    orchestrator.startRun.mockRejectedValue("plain string failure");
    const repoRegistry = makeRepoRegistry([]);
    const logger = makeLogger();
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    await service.startRunsForIssues(["issue-1"]);

    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "plain string failure" },
      "Failed to start run for issue",
    );
  });
});
