import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Do the thing",
    description: "desc",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeDeps() {
  const linearClient = { searchIssues: vi.fn().mockResolvedValue([]) };
  const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
  const orchestrator = { startRun: vi.fn().mockResolvedValue({ id: "run-1" }) };
  const repoRegistry = { listRepos: vi.fn().mockReturnValue([]) };
  const logger = makeLogger();
  return { linearClient, runRepo, orchestrator, repoRegistry, logger };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns [] and logs a warning when no repos are configured for Linear polling", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      { name: "no-linear-repo", linearProject: undefined, assigneeMe: undefined },
    ]);
    const svc = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(deps.linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds one filter per eligible repo (linearProject or assigneeMe) and searches each", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      { name: "repo-a", linearProject: "Project A", linearTeam: "TEAM", assigneeMe: undefined },
      { name: "repo-b", linearProject: undefined, assigneeMe: true, linearTeam: undefined },
      { name: "repo-c", linearProject: undefined, assigneeMe: undefined },
    ]);
    deps.linearClient.searchIssues.mockResolvedValue([]);
    const svc = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    await svc.discoverPendingIssues();

    expect(deps.linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(deps.linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Project A",
      assigneeMe: undefined,
      team: "TEAM",
      state: "Todo",
    });
    expect(deps.linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: undefined,
      assigneeMe: true,
      team: undefined,
      state: "Todo",
    });
  });

  it("dedupes issues seen across multiple filters and excludes issues with an active run", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      { name: "repo-a", linearProject: "Project A" },
      { name: "repo-b", linearProject: "Project B" },
    ]);
    const shared = makeIssue({ id: "shared-1" });
    const onlyInB = makeIssue({ id: "only-b" });
    const hasActiveRun = makeIssue({ id: "has-run" });
    deps.linearClient.searchIssues
      .mockResolvedValueOnce([shared, hasActiveRun])
      .mockResolvedValueOnce([shared, onlyInB]);
    deps.runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "has-run" ? { id: "run-x" } : null),
    );

    const svc = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    const result = await svc.discoverPendingIssues();

    const ids = result.map((i) => i.id).sort();
    expect(ids).toEqual(["only-b", "shared-1"]);
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ candidateCount: 2 }),
      "Discovered pending Linear issues",
    );
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for a fresh issue and skips one that already has an active run", async () => {
    const deps = makeDeps();
    deps.runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "already-running" ? { id: "run-existing" } : null),
    );

    const svc = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    const result = await svc.startRunsForIssues(["fresh-issue", "already-running"]);

    expect(result.started).toEqual(["fresh-issue"]);
    expect(result.skipped).toEqual(["already-running"]);
    expect(deps.orchestrator.startRun).toHaveBeenCalledTimes(1);
    expect(deps.orchestrator.startRun).toHaveBeenCalledWith("fresh-issue");
    expect(deps.logger.info).toHaveBeenCalledWith(
      { started: 1, skipped: 1 },
      "Ingested Linear issues",
    );
  });

  it("catches an error from orchestrator.startRun, logs it, and treats the issue as skipped", async () => {
    const deps = makeDeps();
    const error = new Error("planner unavailable");
    deps.orchestrator.startRun.mockRejectedValueOnce(error);

    const svc = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    const result = await svc.startRunsForIssues(["bad-issue"]);

    expect(result.started).toEqual([]);
    expect(result.skipped).toEqual(["bad-issue"]);
    expect(deps.logger.error).toHaveBeenCalledWith(
      { issueId: "bad-issue", error: "planner unavailable" },
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error throw when logging the failure", async () => {
    const deps = makeDeps();
    deps.orchestrator.startRun.mockRejectedValueOnce("boom");

    const svc = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    await svc.startRunsForIssues(["bad-issue"]);

    expect(deps.logger.error).toHaveBeenCalledWith(
      { issueId: "bad-issue", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("returns empty started/skipped arrays for an empty input list", async () => {
    const deps = makeDeps();
    const svc = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    const result = await svc.startRunsForIssues([]);

    expect(result).toEqual({ started: [], skipped: [] });
    expect(deps.orchestrator.startRun).not.toHaveBeenCalled();
  });
});
