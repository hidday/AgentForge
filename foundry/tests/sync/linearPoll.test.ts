import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { Run } from "../../src/domain/types.js";
import { RunState } from "../../src/domain/runState.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Do the thing",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "PRY-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeLinearClient() {
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

function makeRunRepo() {
  return {
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findById: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };
}

function makeOrchestrator() {
  return {
    startRun: vi.fn().mockResolvedValue(makeRun()),
  };
}

function makeRepoRegistry(repos: Array<Record<string, unknown>>) {
  return {
    listRepos: vi.fn().mockReturnValue(repos),
    getRepoByName: vi.fn(),
    getRepoByLinearProject: vi.fn(),
    getDefaultRepo: vi.fn(),
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
  };
}

describe("LinearPollService.discoverPendingIssues", () => {
  let linearClient: ReturnType<typeof makeLinearClient>;
  let runRepo: ReturnType<typeof makeRunRepo>;
  let orchestrator: ReturnType<typeof makeOrchestrator>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    linearClient = makeLinearClient();
    runRepo = makeRunRepo();
    orchestrator = makeOrchestrator();
    logger = makeLogger();
  });

  it("returns [] and warns when no repos have linearProject or assigneeMe configured", async () => {
    const repoRegistry = makeRepoRegistry([{ name: "repo-a" }]);
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds one search filter per eligible repo and queries with state Todo", async () => {
    const repoRegistry = makeRepoRegistry([
      { name: "repo-a", linearProject: "Project A", linearTeam: "PRA" },
      { name: "repo-b", assigneeMe: true, linearTeam: "PRB" },
      { name: "repo-c" },
    ]);
    linearClient.searchIssues.mockResolvedValue([]);
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenNthCalledWith(1, {
      projectName: "Project A",
      assigneeMe: undefined,
      team: "PRA",
      state: "Todo",
    });
    expect(linearClient.searchIssues).toHaveBeenNthCalledWith(2, {
      projectName: undefined,
      assigneeMe: true,
      team: "PRB",
      state: "Todo",
    });
  });

  it("excludes issues that already have an active run", async () => {
    const repoRegistry = makeRepoRegistry([{ name: "repo-a", linearProject: "Project A" }]);
    const issue1 = makeIssue({ id: "issue-1" });
    const issue2 = makeIssue({ id: "issue-2" });
    linearClient.searchIssues.mockResolvedValue([issue1, issue2]);
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "issue-1" ? makeRun({ linearIssueId: "issue-1" }) : null),
    );
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("issue-2");
  });

  it("deduplicates issues returned by multiple filters (seenIds)", async () => {
    const repoRegistry = makeRepoRegistry([
      { name: "repo-a", linearProject: "Project A" },
      { name: "repo-b", assigneeMe: true },
    ]);
    const sharedIssue = makeIssue({ id: "issue-shared" });
    linearClient.searchIssues.mockResolvedValue([sharedIssue]);
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result).toHaveLength(1);
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(1);
  });

  it("logs the candidate count and filter summary", async () => {
    const repoRegistry = makeRepoRegistry([{ name: "repo-a", linearProject: "Project A", linearTeam: "PRA" }]);
    const issue = makeIssue({ id: "issue-1" });
    linearClient.searchIssues.mockResolvedValue([issue]);
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([issue]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateCount: 1,
        filters: [{ project: "Project A", assigneeMe: undefined, team: "PRA" }],
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
  let repoRegistry: ReturnType<typeof makeRepoRegistry>;
  let service: LinearPollService;

  beforeEach(() => {
    linearClient = makeLinearClient();
    runRepo = makeRunRepo();
    orchestrator = makeOrchestrator();
    logger = makeLogger();
    repoRegistry = makeRepoRegistry([]);
    service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );
  });

  it("returns empty started/skipped for an empty input array", async () => {
    const result = await service.startRunsForIssues([]);

    expect(result).toEqual({ started: [], skipped: [] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { started: 0, skipped: 0 },
      "Ingested Linear issues",
    );
  });

  it("starts a run for an issue with no existing active run", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-1");
    expect(result).toEqual({ started: ["issue-1"], skipped: [] });
  });

  it("skips an issue that already has an active run, without starting it", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(makeRun());

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(orchestrator.startRun).not.toHaveBeenCalled();
    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
  });

  it("continues processing remaining issues when orchestrator.startRun throws for one", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(makeRun());

    const result = await service.startRunsForIssues(["bad-issue", "good-issue"]);

    expect(result).toEqual({ started: ["good-issue"], skipped: ["bad-issue"] });
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "bad-issue", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error thrown value when logging the failure", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValueOnce("plain string failure");

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "plain string failure" },
      "Failed to start run for issue",
    );
  });

  it("processes a mix of started and skipped issues and reports accurate counts", async () => {
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "existing" ? makeRun() : null),
    );

    const result = await service.startRunsForIssues(["existing", "new-1", "new-2"]);

    expect(result.started).toEqual(["new-1", "new-2"]);
    expect(result.skipped).toEqual(["existing"]);
    expect(logger.info).toHaveBeenCalledWith(
      { started: 2, skipped: 1 },
      "Ingested Linear issues",
    );
  });
});
