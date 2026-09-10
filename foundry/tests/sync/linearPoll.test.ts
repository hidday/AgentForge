import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

function makeRepoEntry(overrides: Partial<RepoEntry> & { name: string }): RepoEntry {
  return {
    directory: "/repos/x",
    defaultBranch: "main",
    allowedPaths: ["**"],
    protectedPaths: [],
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 50,
      maxDiffLines: 1000,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    ...overrides,
  };
}

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
    identifier: "PRY-1",
    title: "Issue",
    description: "",
    branchName: "ai/issue",
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
  const linearClient = {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn(),
    postComment: vi.fn(),
    updateIssueState: vi.fn(),
    addLabel: vi.fn(),
    removeLabel: vi.fn(),
    listLabels: vi.fn(),
  };
  const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
  const orchestrator = { startRun: vi.fn().mockResolvedValue({}) };
  const repoRegistry = { listRepos: vi.fn().mockReturnValue([]) };
  const logger = makeLogger();
  return { linearClient, runRepo, orchestrator, repoRegistry, logger };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns [] and warns when no repos have linearProject or assigneeMe configured", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "repo-a" }),
      makeRepoEntry({ name: "repo-b" }),
    ]);
    const service = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(deps.linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("calls searchIssues once per qualifying repo with the right filter shape (state: Todo)", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "repo-project", linearProject: "Foundry", linearTeam: "FDY" }),
      makeRepoEntry({ name: "repo-assignee", assigneeMe: true, linearTeam: "PRY" }),
      makeRepoEntry({ name: "repo-unrelated" }),
    ]);
    deps.linearClient.searchIssues.mockResolvedValue([]);
    const service = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    await service.discoverPendingIssues();

    expect(deps.linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(deps.linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Foundry",
      assigneeMe: undefined,
      team: "FDY",
      state: "Todo",
    });
    expect(deps.linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: undefined,
      assigneeMe: true,
      team: "PRY",
      state: "Todo",
    });
  });

  it("de-duplicates the same issue id returned by two different filters", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "repo-a", linearProject: "Foundry" }),
      makeRepoEntry({ name: "repo-b", assigneeMe: true }),
    ]);
    const dupeIssue = makeIssue({ id: "dupe-1" });
    deps.linearClient.searchIssues
      .mockResolvedValueOnce([dupeIssue])
      .mockResolvedValueOnce([dupeIssue]);
    const service = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("dupe-1");
  });

  it("excludes issues that already have an active run", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "repo-a", linearProject: "Foundry" }),
    ]);
    deps.linearClient.searchIssues.mockResolvedValue([
      makeIssue({ id: "has-run" }),
      makeIssue({ id: "no-run" }),
    ]);
    deps.runRepo.findActiveByIssueId.mockImplementation((issueId: string) =>
      Promise.resolve(issueId === "has-run" ? { id: "run-x" } : null),
    );
    const service = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["no-run"]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("skips an issue that already has an active run without calling orchestrator.startRun", async () => {
    const deps = makeDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-x" });
    const service = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(deps.orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("starts a fresh issue successfully", async () => {
    const deps = makeDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    deps.orchestrator.startRun.mockResolvedValue({ id: "run-new" });
    const service = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: ["issue-1"], skipped: [] });
    expect(deps.orchestrator.startRun).toHaveBeenCalledWith("issue-1");
  });

  it("continues processing other issues when orchestrator.startRun throws for one (partial failure)", async () => {
    const deps = makeDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    deps.orchestrator.startRun.mockImplementation((issueId: string) => {
      if (issueId === "fails") return Promise.reject(new Error("boom"));
      return Promise.resolve({ id: "run-ok" });
    });
    const service = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    const result = await service.startRunsForIssues(["fails", "succeeds"]);

    expect(result.started).toEqual(["succeeds"]);
    expect(result.skipped).toEqual(["fails"]);
    expect(deps.logger.error).toHaveBeenCalledWith(
      { issueId: "fails", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error thrown value for the log message", async () => {
    const deps = makeDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    deps.orchestrator.startRun.mockRejectedValue("plain string failure");
    const service = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(deps.logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "plain string failure" },
      "Failed to start run for issue",
    );
  });
});
