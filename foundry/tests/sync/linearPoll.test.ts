import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    title: "t",
    description: "d",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "backend",
    directory: "backend",
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

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function buildService(opts: {
  repos?: RepoEntry[];
  searchResults?: Record<string, LinearIssue[]>;
  activeRuns?: Set<string>;
}) {
  const repos = opts.repos ?? [makeRepoEntry({ linearProject: "Backend Platform" })];
  const repoRegistry = { listRepos: vi.fn().mockReturnValue(repos) };

  const linearClient = {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    postComment: vi.fn(),
    updateIssueState: vi.fn(),
    addLabel: vi.fn(),
    removeLabel: vi.fn(),
    listLabels: vi.fn(),
    searchIssues: vi.fn().mockImplementation((filter: { projectName?: string; team?: string }) => {
      const key = filter.projectName ?? filter.team ?? "default";
      return Promise.resolve(opts.searchResults?.[key] ?? []);
    }),
  };

  const activeRuns = opts.activeRuns ?? new Set<string>();
  const runRepo = {
    findActiveByIssueId: vi.fn().mockImplementation((id: string) =>
      Promise.resolve(activeRuns.has(id) ? ({ id: `run-for-${id}` } as never) : null),
    ),
    findById: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    findRunsNeedingLinearBackfill: vi.fn(),
    update: vi.fn(),
  };

  const orchestrator = { startRun: vi.fn().mockResolvedValue(undefined) };
  const logger = makeLogger();

  const svc = new LinearPollService(
    linearClient as never,
    runRepo as never,
    orchestrator as never,
    repoRegistry as never,
    logger as never,
  );

  return { svc, linearClient, runRepo, orchestrator, repoRegistry, logger };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns an empty array and warns when no repos are configured for polling", async () => {
    const { svc, logger } = buildService({ repos: [makeRepoEntry()] });
    const result = await svc.discoverPendingIssues();
    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
  });

  it("includes repos configured with a linearProject or assigneeMe", async () => {
    const { svc, linearClient } = buildService({
      repos: [
        makeRepoEntry({ name: "a", linearProject: "Backend" }),
        makeRepoEntry({ name: "b", assigneeMe: true, linearTeam: "Platform" }),
        makeRepoEntry({ name: "c" }),
      ],
      searchResults: { Backend: [makeIssue({ id: "i1" })], Platform: [makeIssue({ id: "i2" })] },
    });

    const result = await svc.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(result.map((i) => i.id).sort()).toEqual(["i1", "i2"]);
  });

  it("deduplicates issues seen across multiple filters", async () => {
    const { svc } = buildService({
      repos: [
        makeRepoEntry({ name: "a", linearProject: "Backend" }),
        makeRepoEntry({ name: "b", linearProject: "Platform" }),
      ],
      searchResults: {
        Backend: [makeIssue({ id: "shared" })],
        Platform: [makeIssue({ id: "shared" }), makeIssue({ id: "unique" })],
      },
    });

    const result = await svc.discoverPendingIssues();
    expect(result.map((i) => i.id).sort()).toEqual(["shared", "unique"]);
  });

  it("excludes issues that already have an active run", async () => {
    const { svc } = buildService({
      repos: [makeRepoEntry({ linearProject: "Backend" })],
      searchResults: { Backend: [makeIssue({ id: "has-run" }), makeIssue({ id: "no-run" })] },
      activeRuns: new Set(["has-run"]),
    });

    const result = await svc.discoverPendingIssues();
    expect(result.map((i) => i.id)).toEqual(["no-run"]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue without an existing active run", async () => {
    const { svc, orchestrator } = buildService({});
    const result = await svc.startRunsForIssues(["i1", "i2"]);

    expect(orchestrator.startRun).toHaveBeenCalledWith("i1");
    expect(orchestrator.startRun).toHaveBeenCalledWith("i2");
    expect(result).toEqual({ started: ["i1", "i2"], skipped: [] });
  });

  it("skips issues that already have an active run", async () => {
    const { svc, orchestrator } = buildService({ activeRuns: new Set(["i1"]) });
    const result = await svc.startRunsForIssues(["i1", "i2"]);

    expect(orchestrator.startRun).not.toHaveBeenCalledWith("i1");
    expect(result).toEqual({ started: ["i2"], skipped: ["i1"] });
  });

  it("skips and logs an issue when starting the run throws", async () => {
    const { svc, orchestrator, logger } = buildService({});
    orchestrator.startRun.mockRejectedValueOnce(new Error("boom"));

    const result = await svc.startRunsForIssues(["i1"]);

    expect(result).toEqual({ started: [], skipped: ["i1"] });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "i1", error: "boom" }),
      "Failed to start run for issue",
    );
  });

  it("logs a summary of started/skipped counts", async () => {
    const { svc, logger } = buildService({ activeRuns: new Set(["i1"]) });
    await svc.startRunsForIssues(["i1", "i2"]);
    expect(logger.info).toHaveBeenCalledWith(
      { started: 1, skipped: 1 },
      "Ingested Linear issues",
    );
  });
});
