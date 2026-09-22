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

function makeRepoRegistry(repos: Array<Record<string, unknown>>) {
  return { listRepos: vi.fn().mockReturnValue(repos) };
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Title",
    description: "Desc",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns [] and warns when no repos have linearProject or assigneeMe configured", async () => {
    const linear = makeLinearClient();
    const runRepo = makeRunRepo();
    const logger = makeLogger();
    const repoRegistry = makeRepoRegistry([{ name: "r1" }]);
    const svc = new LinearPollService(
      linear as never,
      runRepo as never,
      makeOrchestrator() as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(linear.searchIssues).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
  });

  it("builds one search filter per configured repo (by linearProject or assigneeMe) and merges results", async () => {
    const linear = makeLinearClient();
    const issueA = makeIssue({ id: "a" });
    const issueB = makeIssue({ id: "b" });
    linear.searchIssues.mockResolvedValueOnce([issueA]).mockResolvedValueOnce([issueB]);
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const repoRegistry = makeRepoRegistry([
      { name: "r1", linearProject: "Proj A" },
      { name: "r2", assigneeMe: true, linearTeam: "ENG" },
      { name: "r3" }, // neither configured, excluded
    ]);
    const svc = new LinearPollService(
      linear as never,
      runRepo as never,
      makeOrchestrator() as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(linear.searchIssues).toHaveBeenCalledTimes(2);
    expect(linear.searchIssues).toHaveBeenNthCalledWith(1, {
      projectName: "Proj A",
      assigneeMe: undefined,
      team: undefined,
      state: "Todo",
    });
    expect(linear.searchIssues).toHaveBeenNthCalledWith(2, {
      projectName: undefined,
      assigneeMe: true,
      team: "ENG",
      state: "Todo",
    });
    expect(result).toEqual([issueA, issueB]);
  });

  it("de-duplicates issues seen across multiple filters", async () => {
    const linear = makeLinearClient();
    const issue = makeIssue({ id: "shared" });
    linear.searchIssues.mockResolvedValueOnce([issue]).mockResolvedValueOnce([issue]);
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const repoRegistry = makeRepoRegistry([
      { name: "r1", linearProject: "Proj A" },
      { name: "r2", assigneeMe: true },
    ]);
    const svc = new LinearPollService(
      linear as never,
      runRepo as never,
      makeOrchestrator() as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([issue]);
  });

  it("excludes issues that already have an active run", async () => {
    const linear = makeLinearClient();
    const issueOpen = makeIssue({ id: "open" });
    const issueActive = makeIssue({ id: "active" });
    linear.searchIssues.mockResolvedValue([issueOpen, issueActive]);
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "active" ? { id: "run-1" } : null),
    );
    const repoRegistry = makeRepoRegistry([{ name: "r1", linearProject: "Proj A" }]);
    const svc = new LinearPollService(
      linear as never,
      runRepo as never,
      makeOrchestrator() as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([issueOpen]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue without an existing active run", async () => {
    const linear = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    orchestrator.startRun.mockResolvedValue({ id: "run-1" });
    const logger = makeLogger();
    const svc = new LinearPollService(
      linear as never,
      runRepo as never,
      orchestrator as never,
      makeRepoRegistry([]) as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result).toEqual({ started: ["issue-1", "issue-2"], skipped: [] });
    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-1");
    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-2");
    expect(logger.info).toHaveBeenCalledWith({ started: 2, skipped: 0 }, "Ingested Linear issues");
  });

  it("skips an issue that already has an active run without calling startRun", async () => {
    const linear = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "existing-run" });
    const orchestrator = makeOrchestrator();
    const svc = new LinearPollService(
      linear as never,
      runRepo as never,
      orchestrator as never,
      makeRepoRegistry([]) as never,
      makeLogger() as never,
    );

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("catches a startRun failure, logs it, and reports the issue as skipped", async () => {
    const linear = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    orchestrator.startRun.mockRejectedValue(new Error("planner unavailable"));
    const logger = makeLogger();
    const svc = new LinearPollService(
      linear as never,
      runRepo as never,
      orchestrator as never,
      makeRepoRegistry([]) as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "planner unavailable" },
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error rejection from startRun", async () => {
    const linear = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    // eslint-disable-next-line @typescript-eslint/only-throw-error, prefer-promise-reject-errors
    orchestrator.startRun.mockRejectedValue("weird failure");
    const logger = makeLogger();
    const svc = new LinearPollService(
      linear as never,
      runRepo as never,
      orchestrator as never,
      makeRepoRegistry([]) as never,
      logger as never,
    );

    await svc.startRunsForIssues(["issue-1"]);

    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "weird failure" },
      "Failed to start run for issue",
    );
  });

  it("returns empty started/skipped for an empty issueIds list", async () => {
    const svc = new LinearPollService(
      makeLinearClient() as never,
      makeRunRepo() as never,
      makeOrchestrator() as never,
      makeRepoRegistry([]) as never,
      makeLogger() as never,
    );

    const result = await svc.startRunsForIssues([]);

    expect(result).toEqual({ started: [], skipped: [] });
  });
});
