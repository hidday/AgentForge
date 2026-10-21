import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "LIN-1",
    title: "Fix bug",
    description: "desc",
    branchName: "ai/lin-1",
    state: "Todo",
    labels: [],
    priority: 1,
    ...overrides,
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "repo-a",
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

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

beforeEach(() => {
  logger.info.mockClear();
  logger.warn.mockClear();
  logger.error.mockClear();
});

function buildDeps(repos: RepoEntry[]) {
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
    findById: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
    findRunsNeedingLinearBackfill: vi.fn(),
  };
  const orchestrator = {
    startRun: vi.fn().mockResolvedValue({ id: "run-new" }),
  };
  const repoRegistry = {
    listRepos: vi.fn().mockReturnValue(repos),
  };

  const svc = new LinearPollService(
    linearClient as never,
    runRepo as never,
    orchestrator as never,
    repoRegistry as never,
    logger as never,
  );

  return { svc, linearClient, runRepo, orchestrator, repoRegistry };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns an empty list and warns when no repos are configured for polling", async () => {
    const { svc, logger: _l } = buildDeps([makeRepoEntry({ linearProject: undefined, assigneeMe: undefined })]);

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
  });

  it("builds one search filter per eligible repo (linearProject or assigneeMe)", async () => {
    const repos = [
      makeRepoEntry({ name: "a", linearProject: "Core" }),
      makeRepoEntry({ name: "b", assigneeMe: true, linearTeam: "Infra" }),
      makeRepoEntry({ name: "c" }),
    ];
    const { svc, linearClient } = buildDeps(repos);

    await svc.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Core",
      assigneeMe: undefined,
      team: undefined,
      state: "Todo",
    });
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: undefined,
      assigneeMe: true,
      team: "Infra",
      state: "Todo",
    });
  });

  it("deduplicates issues returned by multiple filters", async () => {
    const repos = [
      makeRepoEntry({ name: "a", linearProject: "Core" }),
      makeRepoEntry({ name: "b", linearProject: "Other" }),
    ];
    const { svc, linearClient } = buildDeps(repos);
    const issue = makeIssue({ id: "LIN-shared" });
    linearClient.searchIssues.mockResolvedValueOnce([issue]).mockResolvedValueOnce([issue]);

    const result = await svc.discoverPendingIssues();

    expect(result).toHaveLength(1);
  });

  it("excludes issues that already have an active run", async () => {
    const repos = [makeRepoEntry({ name: "a", linearProject: "Core" })];
    const { svc, linearClient, runRepo } = buildDeps(repos);
    linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "LIN-active" })]);
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "existing-run" });

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
  });

  it("includes issues with no active run as candidates", async () => {
    const repos = [makeRepoEntry({ name: "a", linearProject: "Core" })];
    const { svc, linearClient } = buildDeps(repos);
    const issue = makeIssue({ id: "LIN-new" });
    linearClient.searchIssues.mockResolvedValue([issue]);

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([issue]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue id with no active run", async () => {
    const { svc, orchestrator } = buildDeps([]);

    const result = await svc.startRunsForIssues(["LIN-1", "LIN-2"]);

    expect(result.started).toEqual(["LIN-1", "LIN-2"]);
    expect(result.skipped).toEqual([]);
    expect(orchestrator.startRun).toHaveBeenCalledTimes(2);
  });

  it("skips an issue that already has an active run without starting it", async () => {
    const { svc, runRepo, orchestrator } = buildDeps([]);
    runRepo.findActiveByIssueId.mockResolvedValueOnce({ id: "existing" });

    const result = await svc.startRunsForIssues(["LIN-1"]);

    expect(result.skipped).toEqual(["LIN-1"]);
    expect(result.started).toEqual([]);
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("skips and logs an error when starting a run throws", async () => {
    const { svc, orchestrator } = buildDeps([]);
    orchestrator.startRun.mockRejectedValueOnce(new Error("boom"));

    const result = await svc.startRunsForIssues(["LIN-1"]);

    expect(result.skipped).toEqual(["LIN-1"]);
    expect(result.started).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1", error: "boom" }),
      "Failed to start run for issue",
    );
  });

  it("continues processing remaining issues after one fails", async () => {
    const { svc, orchestrator } = buildDeps([]);
    orchestrator.startRun.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({
      id: "run-2",
    });

    const result = await svc.startRunsForIssues(["LIN-1", "LIN-2"]);

    expect(result.skipped).toEqual(["LIN-1"]);
    expect(result.started).toEqual(["LIN-2"]);
  });

  it("handles a thrown non-Error value by stringifying it", async () => {
    const { svc, orchestrator } = buildDeps([]);
    orchestrator.startRun.mockRejectedValueOnce("plain string failure");

    await svc.startRunsForIssues(["LIN-1"]);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: "plain string failure" }),
      "Failed to start run for issue",
    );
  });
});
