import { describe, it, expect, vi, beforeEach } from "vitest";
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

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    title: "Fix bug",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 1,
    ...overrides,
  };
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

  function makeService(repos: Partial<RepoEntry>[]) {
    const repoRegistry = makeRepoRegistry(repos);
    return new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );
  }

  it("returns an empty array and logs a warning when no repos are configured for polling", async () => {
    const service = makeService([{ name: "repo-a" }]); // no linearProject, no assigneeMe
    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds one search filter per configured repo and returns new issues", async () => {
    const service = makeService([
      { name: "repo-a", linearProject: "Platform", linearTeam: "PRY" },
      { name: "repo-b", assigneeMe: true },
    ]);
    linearClient.searchIssues
      .mockResolvedValueOnce([makeIssue({ id: "a1" })])
      .mockResolvedValueOnce([makeIssue({ id: "b1" })]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const result = await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenNthCalledWith(1, {
      projectName: "Platform",
      assigneeMe: undefined,
      team: "PRY",
      state: "Todo",
    });
    expect(linearClient.searchIssues).toHaveBeenNthCalledWith(2, {
      projectName: undefined,
      assigneeMe: true,
      team: undefined,
      state: "Todo",
    });
    expect(result.map((i) => i.id)).toEqual(["a1", "b1"]);
  });

  it("skips issues that already have an active run", async () => {
    const service = makeService([{ name: "repo-a", linearProject: "Platform" }]);
    linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "a1" }), makeIssue({ id: "a2" })]);
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "a1" ? { id: "run-1" } : null),
    );

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["a2"]);
  });

  it("deduplicates issues that appear in more than one filter's results", async () => {
    const service = makeService([
      { name: "repo-a", linearProject: "Platform" },
      { name: "repo-b", assigneeMe: true },
    ]);
    linearClient.searchIssues
      .mockResolvedValueOnce([makeIssue({ id: "shared" })])
      .mockResolvedValueOnce([makeIssue({ id: "shared" }), makeIssue({ id: "unique" })]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["shared", "unique"]);
    // findActiveByIssueId should only be checked once for the deduplicated "shared" issue.
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(2);
  });

  it("excludes repos with neither linearProject nor assigneeMe from the filter set", async () => {
    const service = makeService([
      { name: "repo-a" },
      { name: "repo-b", linearProject: "Platform" },
    ]);
    linearClient.searchIssues.mockResolvedValue([]);

    await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(1);
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
    service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      makeRepoRegistry([]) as never,
      logger as never,
    );
  });

  it("starts a run for an issue with no active run and reports it as started", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockResolvedValue(undefined);

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: ["issue-1"], skipped: [] });
    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-1");
  });

  it("skips an issue that already has an active run without calling startRun", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-1" });

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("logs and skips an issue when startRun throws", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValue(new Error("planner unavailable"));

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "planner unavailable" },
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error rejection when logging the failure", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    // eslint-disable-next-line prefer-promise-reject-errors
    orchestrator.startRun.mockRejectedValue("raw string failure");

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "raw string failure" },
      "Failed to start run for issue",
    );
  });

  it("processes a mixed batch independently, continuing after a failure", async () => {
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "already-running" ? { id: "run-x" } : null),
    );
    orchestrator.startRun.mockImplementation((id: string) =>
      id === "boom" ? Promise.reject(new Error("fail")) : Promise.resolve(undefined),
    );

    const result = await service.startRunsForIssues(["new-1", "already-running", "boom"]);

    expect(result.started).toEqual(["new-1"]);
    expect(result.skipped).toEqual(["already-running", "boom"]);
  });

  it("returns empty started/skipped for an empty input list", async () => {
    const result = await service.startRunsForIssues([]);
    expect(result).toEqual({ started: [], skipped: [] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });
});
