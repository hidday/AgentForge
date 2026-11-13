import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Test issue",
    description: "desc",
    branchName: "ai/pry-1",
    state: "Todo",
    labels: [],
    priority: 2,
    ...overrides,
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "acme/widgets",
    directory: "./widgets",
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

function makeLinearClient() {
  return {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn(),
    postComment: vi.fn(),
    updateIssueState: vi.fn(),
    addLabel: vi.fn(),
    removeLabel: vi.fn(),
    listLabels: vi.fn(),
  };
}

function makeRunRepo() {
  return {
    findActiveByIssueId: vi.fn(),
  };
}

function makeOrchestrator() {
  return {
    startRun: vi.fn(),
  };
}

function makeRepoRegistry(repos: RepoEntry[]) {
  return {
    listRepos: vi.fn().mockReturnValue(repos),
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns [] and logs a warning when no repos have linearProject or assigneeMe configured", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    const orchestrator = makeOrchestrator();
    const logger = makeLogger();
    const repoRegistry = makeRepoRegistry([makeRepoEntry({ linearProject: undefined, assigneeMe: undefined })]);

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds one filter per matching repo (linearProject or assigneeMe) and searches each", async () => {
    const linearClient = makeLinearClient();
    linearClient.searchIssues.mockResolvedValue([]);
    const runRepo = makeRunRepo();
    const orchestrator = makeOrchestrator();
    const logger = makeLogger();
    const repoRegistry = makeRepoRegistry([
      makeRepoEntry({ name: "repoA", linearProject: "Backend Platform" }),
      makeRepoEntry({ name: "repoB", assigneeMe: true, linearTeam: "PRY" }),
      makeRepoEntry({ name: "repoC" }),
    ]);

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    await svc.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Backend Platform",
      assigneeMe: undefined,
      team: undefined,
      state: "Todo",
    });
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: undefined,
      assigneeMe: true,
      team: "PRY",
      state: "Todo",
    });
  });

  it("dedupes issues seen across multiple filters by id", async () => {
    const linearClient = makeLinearClient();
    const sharedIssue = makeIssue({ id: "shared-1" });
    linearClient.searchIssues
      .mockResolvedValueOnce([sharedIssue])
      .mockResolvedValueOnce([sharedIssue]);
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    const logger = makeLogger();
    const repoRegistry = makeRepoRegistry([
      makeRepoEntry({ name: "repoA", linearProject: "Proj A" }),
      makeRepoEntry({ name: "repoB", linearProject: "Proj B" }),
    ]);

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("shared-1");
  });

  it("excludes issues that already have an active run", async () => {
    const linearClient = makeLinearClient();
    linearClient.searchIssues.mockResolvedValue([
      makeIssue({ id: "has-active-run" }),
      makeIssue({ id: "no-active-run" }),
    ]);
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockImplementation(async (id: string) =>
      id === "has-active-run" ? { id: "run-1" } : null,
    );
    const orchestrator = makeOrchestrator();
    const logger = makeLogger();
    const repoRegistry = makeRepoRegistry([makeRepoEntry({ linearProject: "Proj A" })]);

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["no-active-run"]);
  });

  it("logs candidateCount and filter metadata", async () => {
    const linearClient = makeLinearClient();
    linearClient.searchIssues.mockResolvedValue([makeIssue()]);
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const orchestrator = makeOrchestrator();
    const logger = makeLogger();
    const repoRegistry = makeRepoRegistry([
      makeRepoEntry({ linearProject: "Backend Platform" }),
    ]);

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    await svc.discoverPendingIssues();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateCount: 1,
        filters: [{ project: "Backend Platform", assigneeMe: undefined, team: undefined }],
      }),
      "Discovered pending Linear issues",
    );
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  let linearClient: ReturnType<typeof makeLinearClient>;
  let runRepo: ReturnType<typeof makeRunRepo>;
  let orchestrator: ReturnType<typeof makeOrchestrator>;
  let logger: ReturnType<typeof makeLogger>;
  let svc: LinearPollService;

  beforeEach(() => {
    linearClient = makeLinearClient();
    runRepo = makeRunRepo();
    orchestrator = makeOrchestrator();
    logger = makeLogger();
    const repoRegistry = makeRepoRegistry([]);
    svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );
  });

  it("starts a run for each issue with no active run", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockResolvedValue({ id: "new-run" });

    const result = await svc.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result.started).toEqual(["issue-1", "issue-2"]);
    expect(result.skipped).toEqual([]);
    expect(orchestrator.startRun).toHaveBeenCalledTimes(2);
  });

  it("skips an issue that already has an active run, without calling startRun", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "existing-run" });

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result.skipped).toEqual(["issue-1"]);
    expect(result.started).toEqual([]);
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("skips an issue and logs an error when startRun throws an Error", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValue(new Error("boom"));

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result.skipped).toEqual(["issue-1"]);
    expect(result.started).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error throw value in the error log", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValue("plain string failure");

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result.skipped).toEqual(["issue-1"]);
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "plain string failure" },
      "Failed to start run for issue",
    );
  });

  it("handles a mix of started and skipped issues and logs the final counts", async () => {
    runRepo.findActiveByIssueId.mockImplementation(async (id: string) =>
      id === "existing" ? { id: "run" } : null,
    );
    orchestrator.startRun.mockResolvedValue({ id: "new-run" });

    const result = await svc.startRunsForIssues(["existing", "fresh"]);

    expect(result.started).toEqual(["fresh"]);
    expect(result.skipped).toEqual(["existing"]);
    expect(logger.info).toHaveBeenCalledWith(
      { started: 1, skipped: 1 },
      "Ingested Linear issues",
    );
  });
});
