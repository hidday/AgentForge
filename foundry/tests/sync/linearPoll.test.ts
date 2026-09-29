import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "/repos/repo-a",
    defaultBranch: "main",
    allowedPaths: [],
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
    title: "Do the thing",
    description: "desc",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
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
    create: vi.fn(),
    findAll: vi.fn(),
    findById: vi.fn(),
    findByIssueId: vi.fn(),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    updateState: vi.fn(),
    findRunsNeedingLinearBackfill: vi.fn(),
    update: vi.fn(),
  };
  const orchestrator = {
    startRun: vi.fn().mockResolvedValue(undefined),
  };
  const repoRegistry = {
    listRepos: vi.fn().mockReturnValue([]),
    getRepoByName: vi.fn(),
    getRepoByLinearProject: vi.fn(),
    getDefaultRepo: vi.fn(),
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
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
  it("logs a warning and returns no candidates when no repo is configured for polling", async () => {
    const deps = buildDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "unconfigured", linearProject: undefined, assigneeMe: undefined }),
    ]);
    const svc = buildService(deps);

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(deps.linearClient.searchIssues).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
  });

  it("builds one filter per eligible repo (linearProject or assigneeMe) and searches each", async () => {
    const deps = buildDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
      makeRepoEntry({ name: "repo-b", assigneeMe: true, linearTeam: "ENG" }),
      makeRepoEntry({ name: "repo-c" }),
    ]);
    deps.linearClient.searchIssues.mockResolvedValue([]);
    const svc = buildService(deps);

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
      team: "ENG",
      state: "Todo",
    });
  });

  it("dedupes issues seen across multiple filters and excludes issues with an active run", async () => {
    const deps = buildDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
      makeRepoEntry({ name: "repo-b", linearProject: "Project B" }),
    ]);
    const sharedIssue = makeIssue({ id: "shared-1" });
    const uniqueIssue = makeIssue({ id: "unique-1" });
    const activeRunIssue = makeIssue({ id: "has-active-run" });

    deps.linearClient.searchIssues
      .mockResolvedValueOnce([sharedIssue, activeRunIssue])
      .mockResolvedValueOnce([sharedIssue, uniqueIssue]);

    deps.runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "has-active-run" ? ({ id: "run-x" } as never) : null),
    );

    const svc = buildService(deps);
    const result = await svc.discoverPendingIssues();

    const ids = result.map((i) => i.id).sort();
    expect(ids).toEqual(["shared-1", "unique-1"]);
    // shared-1 should only be checked against runRepo once despite appearing twice
    expect(
      deps.runRepo.findActiveByIssueId.mock.calls.filter((c) => c[0] === "shared-1").length,
    ).toBe(1);
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ candidateCount: 2 }),
      "Discovered pending Linear issues",
    );
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue without an active run and reports it as started", async () => {
    const deps = buildDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = buildService(deps);

    const result = await svc.startRunsForIssues(["issue-1", "issue-2"]);

    expect(deps.orchestrator.startRun).toHaveBeenCalledWith("issue-1");
    expect(deps.orchestrator.startRun).toHaveBeenCalledWith("issue-2");
    expect(result).toEqual({ started: ["issue-1", "issue-2"], skipped: [] });
    expect(deps.logger.info).toHaveBeenCalledWith(
      { started: 2, skipped: 0 },
      "Ingested Linear issues",
    );
  });

  it("skips issues that already have an active run without starting a new one", async () => {
    const deps = buildDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue({ id: "existing-run" } as never);
    const svc = buildService(deps);

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(deps.orchestrator.startRun).not.toHaveBeenCalled();
    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
  });

  it("logs the error and marks the issue skipped when starting a run throws", async () => {
    const deps = buildDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    deps.orchestrator.startRun.mockRejectedValue(new Error("boom"));
    const svc = buildService(deps);

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(deps.logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("stringifies non-Error rejections when logging the failure", async () => {
    const deps = buildDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    deps.orchestrator.startRun.mockRejectedValue("weird failure");
    const svc = buildService(deps);

    await svc.startRunsForIssues(["issue-1"]);

    expect(deps.logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "weird failure" },
      "Failed to start run for issue",
    );
  });

  it("continues processing remaining issues after one fails", async () => {
    const deps = buildDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    deps.orchestrator.startRun
      .mockRejectedValueOnce(new Error("first fails"))
      .mockResolvedValueOnce(undefined);
    const svc = buildService(deps);

    const result = await svc.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result).toEqual({ started: ["issue-2"], skipped: ["issue-1"] });
  });

  it("handles an empty issue list", async () => {
    const deps = buildDeps();
    const svc = buildService(deps);
    const result = await svc.startRunsForIssues([]);
    expect(result).toEqual({ started: [], skipped: [] });
    expect(deps.logger.info).toHaveBeenCalledWith(
      { started: 0, skipped: 0 },
      "Ingested Linear issues",
    );
  });
});
