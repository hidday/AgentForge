import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Do the thing",
    description: "desc",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeLinearClient() {
  return {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn().mockResolvedValue([]),
    postComment: vi.fn(),
    updateIssueState: vi.fn(),
    addLabel: vi.fn(),
    removeLabel: vi.fn(),
    listLabels: vi.fn(),
  };
}

function makeRunRepo() {
  return {
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findById: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };
}

function makeOrchestrator() {
  return { startRun: vi.fn().mockResolvedValue({ id: "run-1" }) };
}

function makeRepoRegistry(repos: unknown[] = []) {
  return {
    listRepos: vi.fn().mockReturnValue(repos),
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn(),
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns an empty array and logs a warning when no repos are configured for polling", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([
      { name: "repo-a", linearProject: undefined, assigneeMe: undefined, linearTeam: undefined },
    ]);
    const logger = makeLogger();

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

  it("builds one search filter per eligible repo and returns candidates not already tracked by an active run", async () => {
    const linearClient = makeLinearClient();
    const issueA = makeIssue({ id: "issue-a" });
    const issueB = makeIssue({ id: "issue-b" });
    linearClient.searchIssues
      .mockResolvedValueOnce([issueA])
      .mockResolvedValueOnce([issueB]);

    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([
      { name: "repo-a", linearProject: "Alpha", assigneeMe: undefined, linearTeam: undefined },
      { name: "repo-b", linearProject: undefined, assigneeMe: true, linearTeam: "ENG" },
      { name: "repo-c", linearProject: undefined, assigneeMe: undefined, linearTeam: undefined },
    ]);
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
    expect(result).toEqual([issueA, issueB]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ candidateCount: 2 }),
      "Discovered pending Linear issues",
    );
  });

  it("deduplicates issues seen across multiple filters", async () => {
    const linearClient = makeLinearClient();
    const sharedIssue = makeIssue({ id: "shared" });
    linearClient.searchIssues
      .mockResolvedValueOnce([sharedIssue])
      .mockResolvedValueOnce([sharedIssue]);

    const runRepo = makeRunRepo();
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([
      { name: "repo-a", linearProject: "Alpha" },
      { name: "repo-b", linearProject: "Beta" },
    ]);

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("shared");
    // findActiveByIssueId should only be checked once for the deduplicated issue
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(1);
  });

  it("excludes issues that already have an active run", async () => {
    const linearClient = makeLinearClient();
    const issue = makeIssue({ id: "already-running" });
    linearClient.searchIssues.mockResolvedValue([issue]);

    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-existing" });

    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([{ name: "repo-a", linearProject: "Alpha" }]);

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
  });

  it("propagates an error when searchIssues fails", async () => {
    const linearClient = makeLinearClient();
    linearClient.searchIssues.mockRejectedValue(new Error("linear search failed"));

    const runRepo = makeRunRepo();
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([{ name: "repo-a", linearProject: "Alpha" }]);

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    await expect(svc.discoverPendingIssues()).rejects.toThrow("linear search failed");
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue id with no existing active run", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry();
    const logger = makeLogger();

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result).toEqual({ started: ["issue-1", "issue-2"], skipped: [] });
    expect(orchestrator.startRun).toHaveBeenCalledTimes(2);
    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-1");
    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-2");
    expect(logger.info).toHaveBeenCalledWith(
      { started: 2, skipped: 0 },
      "Ingested Linear issues",
    );
  });

  it("skips an issue id that already has an active run without starting it", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "existing-run" });
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry();

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("catches an error from orchestrator.startRun, logs it, and records the issue as skipped", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    orchestrator.startRun.mockRejectedValue(new Error("planner crashed"));
    const repoRegistry = makeRepoRegistry();
    const logger = makeLogger();

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "planner crashed" },
      "Failed to start run for issue",
    );
  });

  it("falls back to String(err) when startRun throws a non-Error value", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    orchestrator.startRun.mockRejectedValue("boom");
    const repoRegistry = makeRepoRegistry();
    const logger = makeLogger();

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    await svc.startRunsForIssues(["issue-1"]);

    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("handles a mix of started and skipped issues in one batch", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "existing" })
      .mockResolvedValueOnce(null);
    const orchestrator = makeOrchestrator();
    orchestrator.startRun
      .mockResolvedValueOnce({ id: "run-1" })
      .mockRejectedValueOnce(new Error("fail"));
    const repoRegistry = makeRepoRegistry();
    const logger = makeLogger();

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["issue-1", "issue-2", "issue-3"]);

    expect(result.started).toEqual(["issue-1"]);
    expect(result.skipped).toEqual(["issue-2", "issue-3"]);
  });

  it("returns empty started/skipped arrays for an empty input", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry();
    const logger = makeLogger();

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues([]);

    expect(result).toEqual({ started: [], skipped: [] });
    expect(logger.info).toHaveBeenCalledWith(
      { started: 0, skipped: 0 },
      "Ingested Linear issues",
    );
  });
});
