import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "LIN-1",
    identifier: "ENG-1",
    title: "Fix the thing",
    description: "desc",
    branchName: "ai/lin-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "acme/widgets",
    directory: "/tmp/widgets",
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
  } as RepoEntry;
}

function buildLinearClient() {
  return {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn().mockResolvedValue([]),
    postComment: vi.fn(),
    updateIssueState: vi.fn(),
    addLabel: vi.fn(),
    removeLabel: vi.fn(),
    listLabels: vi.fn(),
  };
}

function buildRunRepo() {
  return {
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
  };
}

function buildOrchestrator() {
  return {
    startRun: vi.fn().mockResolvedValue({ id: "run-new" }),
  };
}

function buildRepoRegistry(repos: RepoEntry[]) {
  return {
    listRepos: vi.fn().mockReturnValue(repos),
  };
}

function buildLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("LinearPollService.discoverPendingIssues", () => {
  let linearClient: ReturnType<typeof buildLinearClient>;
  let runRepo: ReturnType<typeof buildRunRepo>;
  let orchestrator: ReturnType<typeof buildOrchestrator>;
  let logger: ReturnType<typeof buildLogger>;

  beforeEach(() => {
    linearClient = buildLinearClient();
    runRepo = buildRunRepo();
    orchestrator = buildOrchestrator();
    logger = buildLogger();
  });

  function build(repos: RepoEntry[]) {
    const repoRegistry = buildRepoRegistry(repos);
    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );
    return { svc, repoRegistry };
  }

  it("returns an empty list and logs a warning when no repo is configured for Linear polling", async () => {
    const { svc } = build([makeRepoEntry({ linearProject: undefined, assigneeMe: undefined })]);

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
  });

  it("builds a search filter for repos with a linearProject configured", async () => {
    const { svc } = build([
      makeRepoEntry({ name: "acme/widgets", linearProject: "Widgets", linearTeam: "ENG" }),
    ]);
    linearClient.searchIssues.mockResolvedValue([]);

    await svc.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Widgets",
      assigneeMe: undefined,
      team: "ENG",
      state: "Todo",
    });
  });

  it("builds a search filter for repos with assigneeMe=true configured", async () => {
    const { svc } = build([makeRepoEntry({ name: "acme/widgets", assigneeMe: true })]);
    linearClient.searchIssues.mockResolvedValue([]);

    await svc.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: undefined,
      assigneeMe: true,
      team: undefined,
      state: "Todo",
    });
  });

  it("excludes repos with neither linearProject nor assigneeMe from the filters", async () => {
    const { svc } = build([
      makeRepoEntry({ name: "no-linear-repo", linearProject: undefined, assigneeMe: undefined }),
      makeRepoEntry({ name: "has-project", linearProject: "Widgets" }),
    ]);
    linearClient.searchIssues.mockResolvedValue([]);

    await svc.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(1);
  });

  it("returns issues that have no existing active run", async () => {
    const issue = makeIssue({ id: "LIN-1" });
    const { svc } = build([makeRepoEntry({ linearProject: "Widgets" })]);
    linearClient.searchIssues.mockResolvedValue([issue]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([issue]);
  });

  it("excludes issues that already have an active run", async () => {
    const issue = makeIssue({ id: "LIN-1" });
    const { svc } = build([makeRepoEntry({ linearProject: "Widgets" })]);
    linearClient.searchIssues.mockResolvedValue([issue]);
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "existing-run" });

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
  });

  it("de-duplicates issues seen across multiple filters (e.g. two repos sharing a project)", async () => {
    const issue = makeIssue({ id: "LIN-1" });
    const { svc } = build([
      makeRepoEntry({ name: "repo-a", linearProject: "Widgets" }),
      makeRepoEntry({ name: "repo-b", assigneeMe: true }),
    ]);
    linearClient.searchIssues.mockResolvedValue([issue]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const result = await svc.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(result).toEqual([issue]);
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(1);
  });

  it("logs the discovered candidate count and filter summary", async () => {
    const { svc } = build([makeRepoEntry({ linearProject: "Widgets", linearTeam: "ENG" })]);
    linearClient.searchIssues.mockResolvedValue([makeIssue()]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.discoverPendingIssues();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateCount: 1,
        filters: [{ project: "Widgets", assigneeMe: undefined, team: "ENG" }],
      }),
      "Discovered pending Linear issues",
    );
  });

  it("propagates errors from the Linear client search", async () => {
    const { svc } = build([makeRepoEntry({ linearProject: "Widgets" })]);
    linearClient.searchIssues.mockRejectedValueOnce(new Error("Linear timeout"));

    await expect(svc.discoverPendingIssues()).rejects.toThrow("Linear timeout");
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  let linearClient: ReturnType<typeof buildLinearClient>;
  let runRepo: ReturnType<typeof buildRunRepo>;
  let orchestrator: ReturnType<typeof buildOrchestrator>;
  let repoRegistry: ReturnType<typeof buildRepoRegistry>;
  let logger: ReturnType<typeof buildLogger>;
  let svc: LinearPollService;

  beforeEach(() => {
    linearClient = buildLinearClient();
    runRepo = buildRunRepo();
    orchestrator = buildOrchestrator();
    repoRegistry = buildRepoRegistry([]);
    logger = buildLogger();
    svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );
  });

  it("starts a run for each issue with no existing active run", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const result = await svc.startRunsForIssues(["LIN-1", "LIN-2"]);

    expect(orchestrator.startRun).toHaveBeenCalledTimes(2);
    expect(orchestrator.startRun).toHaveBeenCalledWith("LIN-1");
    expect(orchestrator.startRun).toHaveBeenCalledWith("LIN-2");
    expect(result).toEqual({ started: ["LIN-1", "LIN-2"], skipped: [] });
  });

  it("skips an issue that already has an active run without starting one", async () => {
    runRepo.findActiveByIssueId.mockResolvedValueOnce({ id: "existing-run" });

    const result = await svc.startRunsForIssues(["LIN-1"]);

    expect(orchestrator.startRun).not.toHaveBeenCalled();
    expect(result).toEqual({ started: [], skipped: ["LIN-1"] });
  });

  it("skips an issue and logs an error when starting the run throws", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValueOnce(new Error("planner unavailable"));

    const result = await svc.startRunsForIssues(["LIN-1"]);

    expect(result).toEqual({ started: [], skipped: ["LIN-1"] });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1", error: "planner unavailable" }),
      "Failed to start run for issue",
    );
  });

  it("handles a non-Error rejection by stringifying it in the log", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValueOnce("boom");

    const result = await svc.startRunsForIssues(["LIN-1"]);

    expect(result).toEqual({ started: [], skipped: ["LIN-1"] });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1", error: "boom" }),
      "Failed to start run for issue",
    );
  });

  it("continues processing remaining issues after one fails", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce({ id: "run-2" });

    const result = await svc.startRunsForIssues(["LIN-1", "LIN-2"]);

    expect(result).toEqual({ started: ["LIN-2"], skipped: ["LIN-1"] });
  });

  it("returns empty started/skipped arrays for an empty input list", async () => {
    const result = await svc.startRunsForIssues([]);

    expect(result).toEqual({ started: [], skipped: [] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("logs the started and skipped counts", async () => {
    runRepo.findActiveByIssueId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "existing" });

    await svc.startRunsForIssues(["LIN-1", "LIN-2"]);

    expect(logger.info).toHaveBeenCalledWith(
      { started: 1, skipped: 1 },
      "Ingested Linear issues",
    );
  });
});
