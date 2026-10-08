import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    title: "Fix bug",
    description: "desc",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "repo-a",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [],
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    ...overrides,
  };
}

function makeDeps() {
  const linearClient = { searchIssues: vi.fn().mockResolvedValue([]) };
  const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
  const orchestrator = { startRun: vi.fn().mockResolvedValue(undefined) };
  const repoRegistry = { listRepos: vi.fn().mockReturnValue([]) };
  const logger = makeLogger();
  return { linearClient, runRepo, orchestrator, repoRegistry, logger };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns an empty list and warns when no repos are configured for polling", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ linearProject: undefined, assigneeMe: undefined })]);
    const svc = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    const issues = await svc.discoverPendingIssues();

    expect(issues).toEqual([]);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(deps.linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds one search filter per repo with a linearProject or assigneeMe set", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
      makeRepoEntry({ name: "repo-b", assigneeMe: true, linearTeam: "Team B" }),
      makeRepoEntry({ name: "repo-c" }),
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
      team: undefined,
      state: "Todo",
    });
    expect(deps.linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: undefined,
      assigneeMe: true,
      team: "Team B",
      state: "Todo",
    });
  });

  it("excludes issues that already have an active run", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ linearProject: "Project A" })]);
    deps.linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "issue-1" }), makeIssue({ id: "issue-2" })]);
    deps.runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "issue-1" ? { id: "run-1" } : null),
    );
    const svc = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    const issues = await svc.discoverPendingIssues();

    expect(issues.map((i) => i.id)).toEqual(["issue-2"]);
  });

  it("de-duplicates an issue returned by more than one filter", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
      makeRepoEntry({ name: "repo-b", assigneeMe: true }),
    ]);
    deps.linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "issue-shared" })]);
    const svc = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    const issues = await svc.discoverPendingIssues();

    expect(issues).toHaveLength(1);
    expect(deps.runRepo.findActiveByIssueId).toHaveBeenCalledTimes(1);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue with no existing active run", async () => {
    const deps = makeDeps();
    const svc = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    const result = await svc.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result).toEqual({ started: ["issue-1", "issue-2"], skipped: [] });
    expect(deps.orchestrator.startRun).toHaveBeenCalledTimes(2);
  });

  it("skips an issue that already has an active run without starting it again", async () => {
    const deps = makeDeps();
    deps.runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "issue-1" ? { id: "run-1" } : null),
    );
    const svc = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    const result = await svc.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result).toEqual({ started: ["issue-2"], skipped: ["issue-1"] });
    expect(deps.orchestrator.startRun).toHaveBeenCalledTimes(1);
    expect(deps.orchestrator.startRun).toHaveBeenCalledWith("issue-2");
  });

  it("logs and skips an issue when starting the run throws", async () => {
    const deps = makeDeps();
    deps.orchestrator.startRun.mockRejectedValue(new Error("boom"));
    const svc = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      deps.logger as never,
    );

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "issue-1", error: "boom" }),
      "Failed to start run for issue",
    );
  });
});
