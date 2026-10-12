import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "test-repo",
    directory: "/repos/test-repo",
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

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Fix bug",
    description: "desc",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function buildDeps() {
  const linearClient = { searchIssues: vi.fn().mockResolvedValue([]) };
  const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
  const orchestrator = { startRun: vi.fn().mockResolvedValue({}) };
  const repoRegistry = { listRepos: vi.fn().mockReturnValue([]) };
  const logger = makeLogger();

  return { linearClient, runRepo, orchestrator, repoRegistry, logger };
}

function buildService(deps: ReturnType<typeof buildDeps>) {
  return new LinearPollService(
    deps.linearClient as never,
    deps.runRepo as never,
    deps.orchestrator as never,
    deps.repoRegistry as never,
    deps.logger as never,
  );
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns an empty array and logs a warning when no repos are configured for Linear polling", async () => {
    const deps = buildDeps();
    deps.repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ linearProject: undefined, assigneeMe: undefined })]);
    const service = buildService(deps);

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(deps.linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds one filter per eligible repo (linearProject or assigneeMe) and searches each", async () => {
    const deps = buildDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
      makeRepoEntry({ name: "repo-b", assigneeMe: true, linearTeam: "ENG" }),
      makeRepoEntry({ name: "repo-c" }), // not eligible: no linearProject, no assigneeMe
    ]);
    deps.linearClient.searchIssues.mockResolvedValue([]);
    const service = buildService(deps);

    await service.discoverPendingIssues();

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
      team: "ENG",
      state: "Todo",
    });
  });

  it("excludes issues that already have an active run", async () => {
    const deps = buildDeps();
    deps.repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ linearProject: "Project A" })]);
    const activeIssue = makeIssue({ id: "issue-active" });
    const pendingIssue = makeIssue({ id: "issue-pending" });
    deps.linearClient.searchIssues.mockResolvedValue([activeIssue, pendingIssue]);
    deps.runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "issue-active" ? { id: "run-1" } : null),
    );
    const service = buildService(deps);

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["issue-pending"]);
  });

  it("dedupes an issue returned by more than one filter", async () => {
    const deps = buildDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
      makeRepoEntry({ name: "repo-b", assigneeMe: true }),
    ]);
    const sharedIssue = makeIssue({ id: "shared-issue" });
    deps.linearClient.searchIssues.mockResolvedValue([sharedIssue]);
    const service = buildService(deps);

    const result = await service.discoverPendingIssues();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("shared-issue");
  });

  it("logs the candidate count and filter summary", async () => {
    const deps = buildDeps();
    deps.repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ linearProject: "Project A" })]);
    deps.linearClient.searchIssues.mockResolvedValue([makeIssue()]);
    const service = buildService(deps);

    await service.discoverPendingIssues();

    expect(deps.logger.info).toHaveBeenCalledWith(
      {
        candidateCount: 1,
        filters: [{ project: "Project A", assigneeMe: undefined, team: undefined }],
      },
      "Discovered pending Linear issues",
    );
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue id without an existing active run", async () => {
    const deps = buildDeps();
    const service = buildService(deps);

    const result = await service.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result).toEqual({ started: ["issue-1", "issue-2"], skipped: [] });
    expect(deps.orchestrator.startRun).toHaveBeenCalledWith("issue-1");
    expect(deps.orchestrator.startRun).toHaveBeenCalledWith("issue-2");
  });

  it("skips an issue id that already has an active run", async () => {
    const deps = buildDeps();
    deps.runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "issue-1" ? { id: "run-1" } : null),
    );
    const service = buildService(deps);

    const result = await service.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result).toEqual({ started: ["issue-2"], skipped: ["issue-1"] });
    expect(deps.orchestrator.startRun).toHaveBeenCalledTimes(1);
    expect(deps.orchestrator.startRun).toHaveBeenCalledWith("issue-2");
  });

  it("skips and logs an error when orchestrator.startRun throws", async () => {
    const deps = buildDeps();
    deps.orchestrator.startRun.mockRejectedValue(new Error("boom"));
    const service = buildService(deps);

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(deps.logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error throwable when logging the failure", async () => {
    const deps = buildDeps();
    deps.orchestrator.startRun.mockRejectedValue("non-error-failure");
    const service = buildService(deps);

    await service.startRunsForIssues(["issue-1"]);

    expect(deps.logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "non-error-failure" },
      "Failed to start run for issue",
    );
  });

  it("logs the started/skipped counts", async () => {
    const deps = buildDeps();
    deps.runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "issue-1" ? { id: "run-1" } : null),
    );
    const service = buildService(deps);

    await service.startRunsForIssues(["issue-1", "issue-2"]);

    expect(deps.logger.info).toHaveBeenCalledWith(
      { started: 1, skipped: 1 },
      "Ingested Linear issues",
    );
  });

  it("handles an empty issueIds array", async () => {
    const deps = buildDeps();
    const service = buildService(deps);

    const result = await service.startRunsForIssues([]);

    expect(result).toEqual({ started: [], skipped: [] });
    expect(deps.orchestrator.startRun).not.toHaveBeenCalled();
  });
});
