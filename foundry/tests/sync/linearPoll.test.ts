import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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

function makeRepoRegistry(repos: unknown[]) {
  return { listRepos: vi.fn().mockReturnValue(repos) };
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Do something",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns an empty array and warns when no repos have linearProject or assigneeMe configured", async () => {
    const linearClient = makeLinearClient();
    const logger = makeLogger();
    const svc = new LinearPollService(
      linearClient as never,
      makeRunRepo() as never,
      makeOrchestrator() as never,
      makeRepoRegistry([{ name: "repo-a" }]) as never,
      logger as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
  });

  it("builds one filter per eligible repo (linearProject or assigneeMe) and merges de-duplicated candidates", async () => {
    const linearClient = makeLinearClient();
    linearClient.searchIssues
      .mockResolvedValueOnce([makeIssue({ id: "a" }), makeIssue({ id: "b" })])
      .mockResolvedValueOnce([makeIssue({ id: "b" }), makeIssue({ id: "c" })]); // "b" is a duplicate

    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const repos = [
      { name: "repo-a", linearProject: "Alpha", linearTeam: undefined, assigneeMe: undefined },
      { name: "repo-b", linearProject: undefined, linearTeam: "PRY", assigneeMe: true },
      { name: "repo-c", linearProject: undefined, assigneeMe: undefined }, // ineligible, excluded
    ];
    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      makeOrchestrator() as never,
      makeRepoRegistry(repos) as never,
      makeLogger() as never,
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
      team: "PRY",
      state: "Todo",
    });
    expect(result.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("excludes an issue that already has an active run", async () => {
    const linearClient = makeLinearClient();
    linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "a" }), makeIssue({ id: "b" })]);

    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "a" ? { id: "run-1" } : null),
    );

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      makeOrchestrator() as never,
      makeRepoRegistry([{ name: "repo-a", linearProject: "Alpha" }]) as never,
      makeLogger() as never,
    );

    const result = await svc.discoverPendingIssues();
    expect(result.map((i) => i.id)).toEqual(["b"]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue without an existing active run", async () => {
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    orchestrator.startRun.mockResolvedValue({ id: "run-1" });

    const svc = new LinearPollService(
      makeLinearClient() as never,
      runRepo as never,
      orchestrator as never,
      makeRepoRegistry([]) as never,
      makeLogger() as never,
    );

    const result = await svc.startRunsForIssues(["a", "b"]);

    expect(result.started).toEqual(["a", "b"]);
    expect(result.skipped).toEqual([]);
    expect(orchestrator.startRun).toHaveBeenCalledTimes(2);
  });

  it("skips an issue that already has an active run without calling startRun", async () => {
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "existing-run" });
    const orchestrator = makeOrchestrator();

    const svc = new LinearPollService(
      makeLinearClient() as never,
      runRepo as never,
      orchestrator as never,
      makeRepoRegistry([]) as never,
      makeLogger() as never,
    );

    const result = await svc.startRunsForIssues(["a"]);

    expect(result.started).toEqual([]);
    expect(result.skipped).toEqual(["a"]);
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("catches a startRun failure, logs it, and marks the issue skipped instead of throwing", async () => {
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    orchestrator.startRun.mockRejectedValue(new Error("policy violation"));
    const logger = makeLogger();

    const svc = new LinearPollService(
      makeLinearClient() as never,
      runRepo as never,
      orchestrator as never,
      makeRepoRegistry([]) as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["a"]);

    expect(result.started).toEqual([]);
    expect(result.skipped).toEqual(["a"]);
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "a", error: "policy violation" },
      "Failed to start run for issue",
    );
  });

  it("logs a summary of started/skipped counts", async () => {
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "existing" });
    const orchestrator = makeOrchestrator();
    orchestrator.startRun.mockResolvedValue({ id: "run-1" });
    const logger = makeLogger();

    const svc = new LinearPollService(
      makeLinearClient() as never,
      runRepo as never,
      orchestrator as never,
      makeRepoRegistry([]) as never,
      logger as never,
    );

    await svc.startRunsForIssues(["a", "b"]);

    expect(logger.info).toHaveBeenCalledWith({ started: 1, skipped: 1 }, "Ingested Linear issues");
  });
});
