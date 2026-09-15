import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearClient, LinearIssue } from "../../src/linear/linearClient.js";
import type { RunRepository } from "../../src/orchestrator/runRepository.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import type { RepoRegistry, RepoEntry } from "../../src/config/repoRegistry.js";
import type { Run } from "../../src/domain/types.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

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
    identifier: "ENG-1",
    title: "Do the thing",
    description: "Details",
    branchName: "ai/eng-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeLinearClient(): LinearClient {
  return {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn().mockResolvedValue([]),
    postComment: vi.fn(),
    updateIssueState: vi.fn(),
    addLabel: vi.fn(),
    removeLabel: vi.fn(),
    listLabels: vi.fn(),
  } as unknown as LinearClient;
}

function makeRunRepo(activeRun: Run | null = null): RunRepository {
  return {
    findActiveByIssueId: vi.fn().mockResolvedValue(activeRun),
  } as unknown as RunRepository;
}

function makeOrchestrator(): OrchestratorService {
  return {
    startRun: vi.fn().mockResolvedValue({}),
  } as unknown as OrchestratorService;
}

function makeRepoRegistry(repos: RepoEntry[]): RepoRegistry {
  return {
    listRepos: vi.fn().mockReturnValue(repos),
  } as unknown as RepoRegistry;
}

describe("LinearPollService.discoverPendingIssues", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = makeLogger();
  });

  it("filters repos to those with linearProject or assigneeMe and builds the expected filters", async () => {
    const repos = [
      makeRepoEntry({ name: "with-project", linearProject: "Project X", linearTeam: "PRX" }),
      makeRepoEntry({ name: "with-assignee", assigneeMe: true }),
      makeRepoEntry({ name: "neither" }),
    ];
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo(null);
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry(repos);

    const service = new LinearPollService(linearClient, runRepo, orchestrator, repoRegistry, logger);
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

  it("warns and returns [] when no filters are configured", async () => {
    const repos = [makeRepoEntry({ name: "neither" })];
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo(null);
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry(repos);

    const service = new LinearPollService(linearClient, runRepo, orchestrator, repoRegistry, logger);
    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("de-duplicates issue ids seen across multiple filters/repos", async () => {
    const repos = [
      makeRepoEntry({ name: "repo-a", assigneeMe: true }),
      makeRepoEntry({ name: "repo-b", linearProject: "Project Y" }),
    ];
    const sharedIssue = makeIssue({ id: "dup-1" });
    const linearClient = makeLinearClient();
    (linearClient.searchIssues as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([sharedIssue])
      .mockResolvedValueOnce([sharedIssue]);
    const runRepo = makeRunRepo(null);
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry(repos);

    const service = new LinearPollService(linearClient, runRepo, orchestrator, repoRegistry, logger);
    const result = await service.discoverPendingIssues();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("dup-1");
  });

  it("skips issues that already have an active run", async () => {
    const repos = [makeRepoEntry({ name: "repo-a", assigneeMe: true })];
    const issue = makeIssue({ id: "issue-with-run" });
    const linearClient = makeLinearClient();
    (linearClient.searchIssues as ReturnType<typeof vi.fn>).mockResolvedValue([issue]);
    const runRepo = makeRunRepo({ id: "existing-run" } as Run);
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry(repos);

    const service = new LinearPollService(linearClient, runRepo, orchestrator, repoRegistry, logger);
    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledWith("issue-with-run");
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  let logger: Logger;
  let linearClient: LinearClient;
  let repoRegistry: RepoRegistry;

  beforeEach(() => {
    logger = makeLogger();
    linearClient = makeLinearClient();
    repoRegistry = makeRepoRegistry([]);
  });

  it("skips an issue that already has an active run", async () => {
    const runRepo = makeRunRepo({ id: "existing-run" } as Run);
    const orchestrator = makeOrchestrator();
    const service = new LinearPollService(linearClient, runRepo, orchestrator, repoRegistry, logger);

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("starts a run for a new issue and adds it to started", async () => {
    const runRepo = makeRunRepo(null);
    const orchestrator = makeOrchestrator();
    const service = new LinearPollService(linearClient, runRepo, orchestrator, repoRegistry, logger);

    const result = await service.startRunsForIssues(["issue-2"]);

    expect(result).toEqual({ started: ["issue-2"], skipped: [] });
    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-2");
  });

  it("adds the issue to skipped and logs the error (without rethrowing) when startRun throws", async () => {
    const runRepo = makeRunRepo(null);
    const orchestrator = makeOrchestrator();
    (orchestrator.startRun as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    const service = new LinearPollService(linearClient, runRepo, orchestrator, repoRegistry, logger);

    const result = await service.startRunsForIssues(["issue-3"]);

    expect(result).toEqual({ started: [], skipped: ["issue-3"] });
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-3", error: "boom" },
      "Failed to start run for issue",
    );
  });
});
