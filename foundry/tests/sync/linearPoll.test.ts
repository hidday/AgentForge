import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeMockLinearClient() {
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

function makeMockRunRepo() {
  return {
    findActiveByIssueId: vi.fn(),
    create: vi.fn(),
  };
}

function makeMockOrchestrator() {
  return {
    startRun: vi.fn(),
  };
}

function makeMockRepoRegistry(repos: Partial<RepoEntry>[]) {
  return {
    listRepos: vi.fn().mockReturnValue(repos as RepoEntry[]),
  };
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Fix the bug",
    description: "desc",
    branchName: "ai/eng-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns an empty list and warns when no repos are configured for Linear polling", async () => {
    const linearClient = makeMockLinearClient();
    const runRepo = makeMockRunRepo();
    const orchestrator = makeMockOrchestrator();
    const logger = makeMockLogger();
    const repoRegistry = makeMockRepoRegistry([{ name: "repo-a" }]);

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds one filter per configured repo and returns candidates without an active run", async () => {
    const linearClient = makeMockLinearClient();
    const runRepo = makeMockRunRepo();
    const orchestrator = makeMockOrchestrator();
    const repoRegistry = makeMockRepoRegistry([
      { name: "repo-a", linearProject: "Project A", linearTeam: "PA" },
      { name: "repo-b", assigneeMe: true },
      { name: "repo-c" },
    ]);

    const issueA = makeIssue({ id: "issue-a" });
    const issueB = makeIssue({ id: "issue-b" });
    linearClient.searchIssues.mockImplementation((filter) => {
      if (filter.projectName === "Project A") return Promise.resolve([issueA]);
      if (filter.assigneeMe) return Promise.resolve([issueB]);
      return Promise.resolve([]);
    });
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeMockLogger() as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Project A",
      assigneeMe: undefined,
      team: "PA",
      state: "Todo",
    });
    expect(result.map((i) => i.id)).toEqual(["issue-a", "issue-b"]);
  });

  it("excludes issues that already have an active run", async () => {
    const linearClient = makeMockLinearClient();
    const runRepo = makeMockRunRepo();
    const orchestrator = makeMockOrchestrator();
    const repoRegistry = makeMockRepoRegistry([{ name: "repo-a", linearProject: "P" }]);

    const issue1 = makeIssue({ id: "issue-1" });
    const issue2 = makeIssue({ id: "issue-2" });
    linearClient.searchIssues.mockResolvedValue([issue1, issue2]);
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "issue-1" ? { id: "run-x" } : null),
    );

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeMockLogger() as never,
    );

    const result = await svc.discoverPendingIssues();
    expect(result.map((i) => i.id)).toEqual(["issue-2"]);
  });

  it("deduplicates issues seen across multiple filters", async () => {
    const linearClient = makeMockLinearClient();
    const runRepo = makeMockRunRepo();
    const orchestrator = makeMockOrchestrator();
    const repoRegistry = makeMockRepoRegistry([
      { name: "repo-a", linearProject: "P" },
      { name: "repo-b", assigneeMe: true },
    ]);

    const sharedIssue = makeIssue({ id: "shared-issue" });
    linearClient.searchIssues.mockResolvedValue([sharedIssue]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeMockLogger() as never,
    );

    const result = await svc.discoverPendingIssues();
    expect(result).toHaveLength(1);
    // The second filter's search still runs, but findActiveByIssueId is only
    // consulted once since the id was already seen.
    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list when searchIssues finds nothing for any filter", async () => {
    const linearClient = makeMockLinearClient();
    const runRepo = makeMockRunRepo();
    const orchestrator = makeMockOrchestrator();
    const repoRegistry = makeMockRepoRegistry([{ name: "repo-a", linearProject: "P" }]);
    linearClient.searchIssues.mockResolvedValue([]);

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeMockLogger() as never,
    );

    const result = await svc.discoverPendingIssues();
    expect(result).toEqual([]);
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue id with no active run", async () => {
    const linearClient = makeMockLinearClient();
    const runRepo = makeMockRunRepo();
    const orchestrator = makeMockOrchestrator();
    const repoRegistry = makeMockRepoRegistry([]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockResolvedValue({ id: "run-1" });

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeMockLogger() as never,
    );

    const result = await svc.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result).toEqual({ started: ["issue-1", "issue-2"], skipped: [] });
    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-1");
    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-2");
  });

  it("skips issues that already have an active run without starting a new one", async () => {
    const linearClient = makeMockLinearClient();
    const runRepo = makeMockRunRepo();
    const orchestrator = makeMockOrchestrator();
    const repoRegistry = makeMockRepoRegistry([]);
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "existing-run" });

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeMockLogger() as never,
    );

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("skips and logs an error when starting a run throws an Error", async () => {
    const linearClient = makeMockLinearClient();
    const runRepo = makeMockRunRepo();
    const orchestrator = makeMockOrchestrator();
    const repoRegistry = makeMockRepoRegistry([]);
    const logger = makeMockLogger();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValue(new Error("boom"));

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
      { issueId: "issue-1", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("skips and stringifies a non-Error thrown value", async () => {
    const linearClient = makeMockLinearClient();
    const runRepo = makeMockRunRepo();
    const orchestrator = makeMockOrchestrator();
    const repoRegistry = makeMockRepoRegistry([]);
    const logger = makeMockLogger();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValue("nope");

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result.skipped).toEqual(["issue-1"]);
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "nope" },
      "Failed to start run for issue",
    );
  });

  it("handles an empty issue id list", async () => {
    const linearClient = makeMockLinearClient();
    const runRepo = makeMockRunRepo();
    const orchestrator = makeMockOrchestrator();
    const repoRegistry = makeMockRepoRegistry([]);

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeMockLogger() as never,
    );

    const result = await svc.startRunsForIssues([]);
    expect(result).toEqual({ started: [], skipped: [] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });
});
