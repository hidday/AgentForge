import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

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

function buildLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function buildService(opts: {
  listRepos?: RepoEntry[];
  searchIssues?: ReturnType<typeof vi.fn>;
  findActiveByIssueId?: ReturnType<typeof vi.fn>;
  startRun?: ReturnType<typeof vi.fn>;
}) {
  const logger = buildLogger();
  const linearClient = {
    searchIssues: opts.searchIssues ?? vi.fn().mockResolvedValue([]),
  };
  const runRepo = {
    findActiveByIssueId: opts.findActiveByIssueId ?? vi.fn().mockResolvedValue(null),
  };
  const orchestrator = {
    startRun: opts.startRun ?? vi.fn().mockResolvedValue({}),
  };
  const repoRegistry = {
    listRepos: vi.fn().mockReturnValue(opts.listRepos ?? []),
  };

  const svc = new LinearPollService(
    linearClient as never,
    runRepo as never,
    orchestrator as never,
    repoRegistry as never,
    logger as never,
  );

  return { svc, logger, linearClient, runRepo, orchestrator, repoRegistry };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("warns and returns [] when no repos have linearProject or assigneeMe configured", async () => {
    const { svc, logger, linearClient } = buildService({
      listRepos: [makeRepoEntry({ name: "repo-no-match" })],
    });

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds filters from linearProject and assigneeMe repos and searches with each", async () => {
    const issueA = makeIssue({ id: "a" });
    const issueB = makeIssue({ id: "b" });
    const searchIssues = vi
      .fn()
      .mockResolvedValueOnce([issueA])
      .mockResolvedValueOnce([issueB]);

    const { svc, linearClient } = buildService({
      listRepos: [
        makeRepoEntry({ name: "repo-project", linearProject: "Proj X", linearTeam: "TX" }),
        makeRepoEntry({ name: "repo-assignee", assigneeMe: true, linearTeam: "TY" }),
      ],
      searchIssues,
    });

    const result = await svc.discoverPendingIssues();

    expect(searchIssues).toHaveBeenCalledTimes(2);
    expect(searchIssues).toHaveBeenNthCalledWith(1, {
      projectName: "Proj X",
      assigneeMe: undefined,
      team: "TX",
      state: "Todo",
    });
    expect(searchIssues).toHaveBeenNthCalledWith(2, {
      projectName: undefined,
      assigneeMe: true,
      team: "TY",
      state: "Todo",
    });
    expect(result.map((i) => i.id)).toEqual(["a", "b"]);
    expect(linearClient.searchIssues).toBe(searchIssues);
  });

  it("dedups issues seen across overlapping filter results", async () => {
    const issueA = makeIssue({ id: "a" });
    const searchIssues = vi
      .fn()
      .mockResolvedValueOnce([issueA])
      .mockResolvedValueOnce([issueA]);

    const { svc } = buildService({
      listRepos: [
        makeRepoEntry({ name: "repo-1", linearProject: "P1" }),
        makeRepoEntry({ name: "repo-2", linearProject: "P2" }),
      ],
      searchIssues,
    });

    const result = await svc.discoverPendingIssues();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("excludes issues that already have an active run", async () => {
    const issueA = makeIssue({ id: "a" });
    const issueB = makeIssue({ id: "b" });
    const searchIssues = vi.fn().mockResolvedValue([issueA, issueB]);
    const findActiveByIssueId = vi.fn().mockImplementation((id: string) => {
      if (id === "a") return Promise.resolve({ id: "run-a" });
      return Promise.resolve(null);
    });

    const { svc } = buildService({
      listRepos: [makeRepoEntry({ name: "repo-1", linearProject: "P1" })],
      searchIssues,
      findActiveByIssueId,
    });

    const result = await svc.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["b"]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for an issue with no existing active run", async () => {
    const startRun = vi.fn().mockResolvedValue({ id: "run-1" });
    const findActiveByIssueId = vi.fn().mockResolvedValue(null);

    const { svc, logger } = buildService({ startRun, findActiveByIssueId });

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result.started).toEqual(["issue-1"]);
    expect(result.skipped).toEqual([]);
    expect(startRun).toHaveBeenCalledWith("issue-1");
    expect(logger.info).toHaveBeenCalledWith(
      { started: 1, skipped: 0 },
      "Ingested Linear issues",
    );
  });

  it("skips an issue that already has an existing active run", async () => {
    const startRun = vi.fn();
    const findActiveByIssueId = vi.fn().mockResolvedValue({ id: "existing-run" });

    const { svc } = buildService({ startRun, findActiveByIssueId });

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result.started).toEqual([]);
    expect(result.skipped).toEqual(["issue-1"]);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("catches an error thrown by orchestrator.startRun, logs it, and pushes to skipped", async () => {
    const error = new Error("boom");
    const startRun = vi.fn().mockRejectedValue(error);
    const findActiveByIssueId = vi.fn().mockResolvedValue(null);

    const { svc, logger } = buildService({ startRun, findActiveByIssueId });

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result.started).toEqual([]);
    expect(result.skipped).toEqual(["issue-1"]);
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("handles a mix of started and skipped issues, and stringifies non-Error throws", async () => {
    const findActiveByIssueId = vi.fn().mockImplementation((id: string) => {
      if (id === "already-active") return Promise.resolve({ id: "run-x" });
      return Promise.resolve(null);
    });
    const startRun = vi.fn().mockImplementation((id: string) => {
      if (id === "throws-string") return Promise.reject("non-error-rejection");
      return Promise.resolve({ id: "new-run" });
    });

    const { svc, logger } = buildService({ startRun, findActiveByIssueId });

    const result = await svc.startRunsForIssues(["ok-1", "already-active", "throws-string"]);

    expect(result.started).toEqual(["ok-1"]);
    expect(result.skipped).toEqual(["already-active", "throws-string"]);
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "throws-string", error: "non-error-rejection" },
      "Failed to start run for issue",
    );
  });
});
