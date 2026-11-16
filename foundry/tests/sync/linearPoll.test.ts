import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue, IssueSearchFilter } from "../../src/linear/linearClient.js";
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
    id: "iss-1",
    title: "Some issue",
    description: "desc",
    branchName: "ai/iss-1",
    state: "Todo",
    labels: [],
    priority: 1,
    ...overrides,
  };
}

function buildService(opts: {
  repos?: RepoEntry[];
  searchIssuesImpl?: (filter: IssueSearchFilter) => Promise<LinearIssue[]>;
  activeRunIds?: Set<string>;
} = {}) {
  const repos = opts.repos ?? [];
  const activeRunIds = opts.activeRunIds ?? new Set<string>();

  const linearClient = {
    searchIssues: vi.fn(
      opts.searchIssuesImpl ?? (async () => [] as LinearIssue[]),
    ),
  };
  const runRepo = {
    findActiveByIssueId: vi.fn(async (issueId: string) =>
      activeRunIds.has(issueId) ? { id: `run-for-${issueId}` } : null,
    ),
  };
  const orchestrator = {
    startRun: vi.fn().mockResolvedValue(undefined),
  };
  const repoRegistry = {
    listRepos: vi.fn().mockReturnValue(repos),
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const service = new LinearPollService(
    linearClient as never,
    runRepo as never,
    orchestrator as never,
    repoRegistry as never,
    logger as never,
  );

  return { service, linearClient, runRepo, orchestrator, repoRegistry, logger };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns [] and warns when no repos have linearProject or assigneeMe configured", async () => {
    const { service, linearClient, logger } = buildService({
      repos: [makeRepoEntry({ name: "plain-repo" })],
    });

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds one filter per repo with linearProject and/or assigneeMe, and calls searchIssues for each", async () => {
    const repos = [
      makeRepoEntry({ name: "proj-repo", linearProject: "Project X", linearTeam: "PRX" }),
      makeRepoEntry({ name: "assignee-repo", assigneeMe: true }),
      makeRepoEntry({ name: "plain-repo" }),
    ];
    const { service, linearClient } = buildService({ repos, searchIssuesImpl: async () => [] });

    await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Project X",
      assigneeMe: undefined,
      team: "PRX",
      state: "Todo",
    });
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: undefined,
      assigneeMe: true,
      team: undefined,
      state: "Todo",
    });
  });

  it("dedupes the same issue id returned from two different filters", async () => {
    const repos = [
      makeRepoEntry({ name: "proj-repo", linearProject: "Project X" }),
      makeRepoEntry({ name: "assignee-repo", assigneeMe: true }),
    ];
    const sharedIssue = makeIssue({ id: "shared-1" });
    let call = 0;
    const { service, linearClient } = buildService({
      repos,
      searchIssuesImpl: async () => {
        call += 1;
        return [sharedIssue];
      },
    });

    const result = await service.discoverPendingIssues();

    expect(call).toBe(2);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("shared-1");
  });

  it("excludes an issue for which findActiveByIssueId resolves truthy", async () => {
    const repos = [makeRepoEntry({ name: "proj-repo", linearProject: "Project X" })];
    const issues = [makeIssue({ id: "has-run" }), makeIssue({ id: "no-run" })];
    const { service } = buildService({
      repos,
      searchIssuesImpl: async () => issues,
      activeRunIds: new Set(["has-run"]),
    });

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["no-run"]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("skips an issue that already has an active run, without calling orchestrator.startRun", async () => {
    const { service, orchestrator } = buildService({
      activeRunIds: new Set(["iss-active"]),
    });

    const result = await service.startRunsForIssues(["iss-active"]);

    expect(result).toEqual({ started: [], skipped: ["iss-active"] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("starts a run for an issue with no active run", async () => {
    const { service, orchestrator } = buildService();

    const result = await service.startRunsForIssues(["iss-new"]);

    expect(result).toEqual({ started: ["iss-new"], skipped: [] });
    expect(orchestrator.startRun).toHaveBeenCalledWith("iss-new");
  });

  it("marks the issue as skipped and logs an error when orchestrator.startRun rejects", async () => {
    const { service, orchestrator, logger } = buildService();
    orchestrator.startRun.mockRejectedValueOnce(new Error("boom"));

    const result = await service.startRunsForIssues(["iss-fail"]);

    expect(result).toEqual({ started: [], skipped: ["iss-fail"] });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "iss-fail", error: "boom" }),
      "Failed to start run for issue",
    );
  });

  it("marks the issue as skipped and stringifies a non-Error rejection value", async () => {
    const { service, orchestrator, logger } = buildService();
    orchestrator.startRun.mockRejectedValueOnce("just a string failure");

    const result = await service.startRunsForIssues(["iss-fail-2"]);

    expect(result).toEqual({ started: [], skipped: ["iss-fail-2"] });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "iss-fail-2", error: "just a string failure" }),
      "Failed to start run for issue",
    );
  });

  it("logs a summary with started/skipped counts", async () => {
    const { service, logger, orchestrator } = buildService({
      activeRunIds: new Set(["iss-active"]),
    });
    orchestrator.startRun.mockResolvedValueOnce(undefined);

    await service.startRunsForIssues(["iss-active", "iss-new"]);

    expect(logger.info).toHaveBeenCalledWith(
      { started: 1, skipped: 1 },
      "Ingested Linear issues",
    );
  });
});
