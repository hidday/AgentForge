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
  it("returns an empty list and warns when no repos are configured for polling", async () => {
    const linear = makeLinearClient();
    const runRepo = makeRunRepo();
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([{ name: "repo-a" }]);
    const logger = makeLogger();
    const svc = new LinearPollService(
      linear as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
    expect(linear.searchIssues).not.toHaveBeenCalled();
  });

  it("searches per configured repo (linearProject or assigneeMe) and excludes issues with an active run", async () => {
    const linear = makeLinearClient();
    linear.searchIssues.mockImplementation((filter: { projectName?: string; team?: string }) => {
      if (filter.projectName === "Backend") {
        return Promise.resolve([makeIssue({ id: "a" }), makeIssue({ id: "b" })]);
      }
      if (filter.team === "PRY") {
        return Promise.resolve([makeIssue({ id: "c" })]);
      }
      return Promise.resolve([]);
    });
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "b" ? { id: "run-existing" } : null),
    );
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([
      { name: "repo-backend", linearProject: "Backend" },
      { name: "repo-team", assigneeMe: true, linearTeam: "PRY" },
      { name: "repo-unrelated" },
    ]);
    const svc = new LinearPollService(
      linear as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result.map((i) => i.id).sort()).toEqual(["a", "c"]);
    expect(linear.searchIssues).toHaveBeenCalledTimes(2);
  });

  it("deduplicates an issue seen across multiple filters", async () => {
    const linear = makeLinearClient();
    linear.searchIssues.mockResolvedValue([makeIssue({ id: "shared" })]);
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([
      { name: "repo-a", linearProject: "Backend" },
      { name: "repo-b", linearProject: "Frontend" },
    ]);
    const svc = new LinearPollService(
      linear as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toHaveLength(1);
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(1);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue without an active run", async () => {
    const linear = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    orchestrator.startRun.mockResolvedValue({ id: "new-run" });
    const svc = new LinearPollService(
      linear as never,
      runRepo as never,
      orchestrator as never,
      makeRepoRegistry([]) as never,
      makeLogger() as never,
    );

    const result = await svc.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result.started).toEqual(["issue-1", "issue-2"]);
    expect(result.skipped).toEqual([]);
    expect(orchestrator.startRun).toHaveBeenCalledTimes(2);
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

    expect(result.skipped).toEqual(["issue-1"]);
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("catches an error from startRun, logs it, and records the issue as skipped", async () => {
    const linear = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    orchestrator.startRun.mockRejectedValue(new Error("repo not found"));
    const logger = makeLogger();
    const svc = new LinearPollService(
      linear as never,
      runRepo as never,
      orchestrator as never,
      makeRepoRegistry([]) as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result.skipped).toEqual(["issue-1"]);
    expect(result.started).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "issue-1", error: "repo not found" }),
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error rejection from startRun", async () => {
    const linear = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    orchestrator.startRun.mockRejectedValue("boom");
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
      expect.objectContaining({ issueId: "issue-1", error: "boom" }),
      "Failed to start run for issue",
    );
  });
});
