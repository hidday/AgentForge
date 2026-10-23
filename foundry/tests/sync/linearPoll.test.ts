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
    identifier: "ENG-1",
    title: "Do the thing",
    description: "desc",
    branchName: "ai/eng-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "acme/widget",
    directory: "widget",
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

function buildDeps() {
  const linearClient = {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn().mockResolvedValue([]),
    postComment: vi.fn(),
    updateIssueState: vi.fn(),
    addLabel: vi.fn(),
    removeLabel: vi.fn(),
    listLabels: vi.fn(),
  };
  const runRepo = {
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
  };
  const orchestrator = {
    startRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  };
  const repoRegistry = {
    listRepos: vi.fn().mockReturnValue([]),
  };
  const logger = makeLogger();

  return { linearClient, runRepo, orchestrator, repoRegistry, logger };
}

function buildService(deps: ReturnType<typeof buildDeps>): LinearPollService {
  return new LinearPollService(
    deps.linearClient as never,
    deps.runRepo as never,
    deps.orchestrator as never,
    deps.repoRegistry as never,
    deps.logger as never,
  );
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns an empty array and warns when no repos have linearProject or assigneeMe configured", async () => {
    const deps = buildDeps();
    deps.repoRegistry.listRepos.mockReturnValue([makeRepoEntry()]);
    const service = buildService(deps);

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(deps.linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds a search filter from a repo with linearProject configured", async () => {
    const deps = buildDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ linearProject: "Widget Project", linearTeam: "WID" }),
    ]);
    deps.linearClient.searchIssues.mockResolvedValue([makeIssue()]);
    const service = buildService(deps);

    const result = await service.discoverPendingIssues();

    expect(deps.linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Widget Project",
      assigneeMe: undefined,
      team: "WID",
      state: "Todo",
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("issue-1");
  });

  it("builds a search filter from a repo with assigneeMe=true configured", async () => {
    const deps = buildDeps();
    deps.repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ assigneeMe: true })]);
    deps.linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "issue-2" })]);
    const service = buildService(deps);

    const result = await service.discoverPendingIssues();

    expect(deps.linearClient.searchIssues).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeMe: true, state: "Todo" }),
    );
    expect(result).toHaveLength(1);
  });

  it("excludes issues that already have an active run", async () => {
    const deps = buildDeps();
    deps.repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ assigneeMe: true })]);
    deps.linearClient.searchIssues.mockResolvedValue([
      makeIssue({ id: "issue-1" }),
      makeIssue({ id: "issue-2" }),
    ]);
    deps.runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "issue-1" ? { id: "run-x" } : null),
    );
    const service = buildService(deps);

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["issue-2"]);
  });

  it("deduplicates issues seen across multiple repo filters", async () => {
    const deps = buildDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "repo-a", linearProject: "Proj A" }),
      makeRepoEntry({ name: "repo-b", linearProject: "Proj B" }),
    ]);
    deps.linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "shared-issue" })]);
    const service = buildService(deps);

    const result = await service.discoverPendingIssues();

    expect(deps.linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("shared-issue");
  });

  it("excludes repos with neither linearProject nor assigneeMe from the filter list", async () => {
    const deps = buildDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "no-config" }),
      makeRepoEntry({ name: "has-project", linearProject: "P" }),
    ]);
    deps.linearClient.searchIssues.mockResolvedValue([]);
    const service = buildService(deps);

    await service.discoverPendingIssues();

    expect(deps.linearClient.searchIssues).toHaveBeenCalledTimes(1);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue id and reports it as started", async () => {
    const deps = buildDeps();
    const service = buildService(deps);

    const result = await service.startRunsForIssues(["issue-1", "issue-2"]);

    expect(deps.orchestrator.startRun).toHaveBeenCalledWith("issue-1");
    expect(deps.orchestrator.startRun).toHaveBeenCalledWith("issue-2");
    expect(result).toEqual({ started: ["issue-1", "issue-2"], skipped: [] });
  });

  it("skips an issue that already has an active run without calling startRun", async () => {
    const deps = buildDeps();
    deps.runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "issue-1" ? { id: "run-x" } : null),
    );
    const service = buildService(deps);

    const result = await service.startRunsForIssues(["issue-1", "issue-2"]);

    expect(deps.orchestrator.startRun).not.toHaveBeenCalledWith("issue-1");
    expect(deps.orchestrator.startRun).toHaveBeenCalledWith("issue-2");
    expect(result).toEqual({ started: ["issue-2"], skipped: ["issue-1"] });
  });

  it("catches an error from orchestrator.startRun, logs it, and marks the issue skipped", async () => {
    const deps = buildDeps();
    deps.orchestrator.startRun.mockRejectedValue(new Error("boom"));
    const service = buildService(deps);

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "issue-1", error: "boom" }),
      "Failed to start run for issue",
    );
  });

  it("handles a non-Error rejection by stringifying it", async () => {
    const deps = buildDeps();
    deps.orchestrator.startRun.mockRejectedValue("plain string failure");
    const service = buildService(deps);

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result.skipped).toEqual(["issue-1"]);
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: "plain string failure" }),
      "Failed to start run for issue",
    );
  });

  it("returns empty started/skipped arrays for an empty input", async () => {
    const deps = buildDeps();
    const service = buildService(deps);

    const result = await service.startRunsForIssues([]);

    expect(result).toEqual({ started: [], skipped: [] });
    expect(deps.orchestrator.startRun).not.toHaveBeenCalled();
  });
});
