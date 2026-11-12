import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue, IssueSearchFilter } from "../../src/linear/linearClient.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
    title: "Issue",
    description: "",
    branchName: "ai/issue",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeRepoRegistry(repos: Array<Record<string, unknown>>) {
  return { listRepos: vi.fn().mockReturnValue(repos) };
}

function makeRunRepo(activeIssueIds: Set<string> = new Set()) {
  return {
    findActiveByIssueId: vi.fn().mockImplementation((issueId: string) =>
      Promise.resolve(activeIssueIds.has(issueId) ? { id: `run-for-${issueId}` } : null),
    ),
  };
}

function makeLinearClient(searchResults: Map<string, LinearIssue[]> | LinearIssue[]) {
  return {
    searchIssues: vi.fn().mockImplementation((filter: IssueSearchFilter) => {
      if (Array.isArray(searchResults)) return Promise.resolve(searchResults);
      return Promise.resolve(searchResults.get(filter.projectName ?? filter.team ?? "") ?? []);
    }),
  };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("warns and returns no candidates when no repos have linearProject or assigneeMe configured", async () => {
    const repoRegistry = makeRepoRegistry([{ name: "repo-a" }]);
    const linearClient = makeLinearClient([]);
    const runRepo = makeRunRepo();
    const logger = makeLogger();
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      {} as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
  });

  it("builds one filter per configured repo and returns new candidates not already running", async () => {
    const repoRegistry = makeRepoRegistry([
      { name: "repo-a", linearProject: "Backend Platform" },
      { name: "repo-b", assigneeMe: true, linearTeam: "PRY" },
      { name: "repo-c" }, // neither configured -- excluded
    ]);
    const issueA = makeIssue({ id: "issue-a" });
    const issueB = makeIssue({ id: "issue-b" });
    const results = new Map<string, LinearIssue[]>([
      ["Backend Platform", [issueA]],
      ["PRY", [issueB]],
    ]);
    const linearClient = makeLinearClient(results);
    const runRepo = makeRunRepo();
    const logger = makeLogger();
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      {} as never,
      repoRegistry as never,
      logger as never,
    );

    const candidates = await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Backend Platform",
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
    expect(candidates.map((c) => c.id)).toEqual(["issue-a", "issue-b"]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ candidateCount: 2 }),
      "Discovered pending Linear issues",
    );
  });

  it("deduplicates an issue seen across multiple filters", async () => {
    const repoRegistry = makeRepoRegistry([
      { name: "repo-a", linearProject: "Backend Platform" },
      { name: "repo-b", linearProject: "Other Project" },
    ]);
    const sharedIssue = makeIssue({ id: "shared-issue" });
    const results = new Map<string, LinearIssue[]>([
      ["Backend Platform", [sharedIssue]],
      ["Other Project", [sharedIssue]],
    ]);
    const linearClient = makeLinearClient(results);
    const runRepo = makeRunRepo();
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      {} as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const candidates = await service.discoverPendingIssues();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe("shared-issue");
  });

  it("excludes issues that already have an active run", async () => {
    const repoRegistry = makeRepoRegistry([{ name: "repo-a", linearProject: "Backend Platform" }]);
    const issueWithRun = makeIssue({ id: "already-running" });
    const issueWithoutRun = makeIssue({ id: "fresh-issue" });
    const linearClient = makeLinearClient(
      new Map([["Backend Platform", [issueWithRun, issueWithoutRun]]]),
    );
    const runRepo = makeRunRepo(new Set(["already-running"]));
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      {} as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const candidates = await service.discoverPendingIssues();

    expect(candidates.map((c) => c.id)).toEqual(["fresh-issue"]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("skips issues that already have an active run without starting a new one", async () => {
    const runRepo = makeRunRepo(new Set(["issue-1"]));
    const orchestrator = { startRun: vi.fn() };
    const logger = makeLogger();
    const service = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      logger as never,
    );

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("starts a run for a fresh issue and reports it as started", async () => {
    const runRepo = makeRunRepo();
    const orchestrator = { startRun: vi.fn().mockResolvedValue({ id: "run-1" }) };
    const logger = makeLogger();
    const service = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      logger as never,
    );

    const result = await service.startRunsForIssues(["issue-2"]);

    expect(result).toEqual({ started: ["issue-2"], skipped: [] });
    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-2");
    expect(logger.info).toHaveBeenCalledWith(
      { started: 1, skipped: 0 },
      "Ingested Linear issues",
    );
  });

  it("catches an error from orchestrator.startRun, logs it, and reports the issue as skipped", async () => {
    const runRepo = makeRunRepo();
    const orchestrator = { startRun: vi.fn().mockRejectedValue(new Error("boom")) };
    const logger = makeLogger();
    const service = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      logger as never,
    );

    const result = await service.startRunsForIssues(["issue-3"]);

    expect(result).toEqual({ started: [], skipped: ["issue-3"] });
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-3", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error rejection reason", async () => {
    const runRepo = makeRunRepo();
    const orchestrator = { startRun: vi.fn().mockRejectedValue("plain string failure") };
    const logger = makeLogger();
    const service = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      logger as never,
    );

    await service.startRunsForIssues(["issue-4"]);

    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-4", error: "plain string failure" },
      "Failed to start run for issue",
    );
  });

  it("processes a mix of skipped, started and failed issues, reporting accurate totals", async () => {
    const runRepo = makeRunRepo(new Set(["already-active"]));
    const orchestrator = {
      startRun: vi.fn().mockImplementation((issueId: string) => {
        if (issueId === "will-fail") return Promise.reject(new Error("nope"));
        return Promise.resolve({ id: `run-${issueId}` });
      }),
    };
    const logger = makeLogger();
    const service = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      logger as never,
    );

    const result = await service.startRunsForIssues(["already-active", "will-succeed", "will-fail"]);

    expect(result.started).toEqual(["will-succeed"]);
    expect(result.skipped).toEqual(["already-active", "will-fail"]);
    expect(logger.info).toHaveBeenCalledWith(
      { started: 1, skipped: 2 },
      "Ingested Linear issues",
    );
  });
});
