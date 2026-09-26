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
  return { listRepos: vi.fn().mockReturnValue(repos as RepoEntry[]) };
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Some issue",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns [] and logs a warning when no repo is configured with linearProject or assigneeMe", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    const orchestrator = makeOrchestrator();
    const logger = makeLogger();
    const repoRegistry = makeRepoRegistry([{ name: "repo-a" }]);
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds one filter per matching repo and returns issues with no existing active run", async () => {
    const linearClient = makeLinearClient();
    linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "issue-1" })]);
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([
      { name: "repo-a", linearProject: "Project A" },
      { name: "repo-b" },
    ]);
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(1);
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Project A",
      assigneeMe: undefined,
      team: undefined,
      state: "Todo",
    });
    expect(result).toEqual([makeIssue({ id: "issue-1" })]);
  });

  it("includes assigneeMe repos even without a linearProject", async () => {
    const linearClient = makeLinearClient();
    linearClient.searchIssues.mockResolvedValue([]);
    const runRepo = makeRunRepo();
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([{ name: "repo-a", assigneeMe: true, linearTeam: "PRY" }]);
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: undefined,
      assigneeMe: true,
      team: "PRY",
      state: "Todo",
    });
  });

  it("de-duplicates issues seen across multiple filters", async () => {
    const linearClient = makeLinearClient();
    const shared = makeIssue({ id: "shared-issue" });
    linearClient.searchIssues
      .mockResolvedValueOnce([shared])
      .mockResolvedValueOnce([shared, makeIssue({ id: "issue-2" })]);
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([
      { name: "repo-a", linearProject: "Project A" },
      { name: "repo-b", linearProject: "Project B" },
    ]);
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id).sort()).toEqual(["issue-2", "shared-issue"]);
  });

  it("excludes issues that already have an active run", async () => {
    const linearClient = makeLinearClient();
    linearClient.searchIssues.mockResolvedValue([
      makeIssue({ id: "has-run" }),
      makeIssue({ id: "no-run" }),
    ]);
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "has-run" ? { id: "run-1" } : null),
    );
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([{ name: "repo-a", linearProject: "Project A" }]);
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["no-run"]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue with no existing active run", async () => {
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

    const result = await service.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result.started).toEqual(["issue-1", "issue-2"]);
    expect(result.skipped).toEqual([]);
    expect(orchestrator.startRun).toHaveBeenCalledTimes(2);
  });

  it("skips (without calling startRun) an issue that already has an active run", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "existing-run" });
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

    expect(result.skipped).toEqual(["issue-1"]);
    expect(result.started).toEqual([]);
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("skips and logs an error when orchestrator.startRun throws", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    orchestrator.startRun.mockRejectedValue(new Error("policy violation"));
    const logger = makeLogger();
    const repoRegistry = makeRepoRegistry([]);
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result.skipped).toEqual(["issue-1"]);
    expect(result.started).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "policy violation" },
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error rejection from orchestrator.startRun in the logged error", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    orchestrator.startRun.mockRejectedValue("rate limited");
    const logger = makeLogger();
    const repoRegistry = makeRepoRegistry([]);
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result.skipped).toEqual(["issue-1"]);
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "rate limited" },
      "Failed to start run for issue",
    );
  });

  it("handles a mix of started and skipped issues in one batch", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "already-running" ? { id: "run-x" } : null),
    );
    const orchestrator = makeOrchestrator();
    orchestrator.startRun.mockImplementation((id: string) =>
      id === "fails-to-start" ? Promise.reject(new Error("boom")) : Promise.resolve({ id: "run" }),
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
      "already-running",
      "fails-to-start",
      "starts-fine",
    ]);

    expect(result.started).toEqual(["starts-fine"]);
    expect(result.skipped.sort()).toEqual(["already-running", "fails-to-start"]);
  });
});
