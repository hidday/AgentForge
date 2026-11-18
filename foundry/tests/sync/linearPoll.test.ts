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
  return {
    findActiveByIssueId: vi.fn(),
  };
}

function makeOrchestrator() {
  return {
    startRun: vi.fn(),
  };
}

function makeRepoRegistry(repos: Partial<RepoEntry>[]) {
  return {
    listRepos: vi.fn().mockReturnValue(repos),
  };
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    title: "Title",
    description: "Description",
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

  beforeEach(() => {
    linearClient = makeLinearClient();
    runRepo = makeRunRepo();
    orchestrator = makeOrchestrator();
  });

  function makeService(repos: Partial<RepoEntry>[]) {
    const repoRegistry = makeRepoRegistry(repos);
    return new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );
  }

  it("returns an empty array and warns when no repos have a linearProject or assigneeMe", async () => {
    const service = makeService([{ name: "repo-a" }]);

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds a filter per matching repo and returns new candidate issues", async () => {
    const service = makeService([
      { name: "repo-a", linearProject: "Backend" },
      { name: "repo-b", assigneeMe: true, linearTeam: "PRY" },
    ]);
    linearClient.searchIssues.mockResolvedValueOnce([makeIssue({ id: "a" })]);
    linearClient.searchIssues.mockResolvedValueOnce([makeIssue({ id: "b" })]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const result = await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Backend",
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
    expect(result.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("excludes issues that already have an active run", async () => {
    const service = makeService([{ name: "repo-a", linearProject: "Backend" }]);
    linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "a" })]);
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-1" });

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
  });

  it("deduplicates issues seen across multiple filters", async () => {
    const service = makeService([
      { name: "repo-a", linearProject: "Backend" },
      { name: "repo-b", linearProject: "Infra" },
    ]);
    linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "shared" })]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const result = await service.discoverPendingIssues();

    expect(result).toHaveLength(1);
    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(1);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  let linearClient: ReturnType<typeof makeLinearClient>;
  let runRepo: ReturnType<typeof makeRunRepo>;
  let orchestrator: ReturnType<typeof makeOrchestrator>;
  let service: LinearPollService;

  beforeEach(() => {
    linearClient = makeLinearClient();
    runRepo = makeRunRepo();
    orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([]);
    service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );
  });

  it("starts a run for an issue with no active run", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockResolvedValue({ id: "run-1" });

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

  it("skips and logs an issue when startRun throws", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValue(new Error("boom"));

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
  });

  it("skips an issue when startRun throws a non-Error value", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValue("string failure");

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
  });

  it("processes a mix of issues independently", async () => {
    runRepo.findActiveByIssueId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "run-existing" })
      .mockResolvedValueOnce(null);
    orchestrator.startRun
      .mockResolvedValueOnce({ id: "run-new" })
      .mockRejectedValueOnce(new Error("boom"));

    const result = await service.startRunsForIssues(["a", "b", "c"]);

    expect(result.started).toEqual(["a"]);
    expect(result.skipped).toEqual(["b", "c"]);
  });

  it("handles an empty issueIds array", async () => {
    const result = await service.startRunsForIssues([]);
    expect(result).toEqual({ started: [], skipped: [] });
  });
});
