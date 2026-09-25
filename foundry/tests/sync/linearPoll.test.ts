import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearClient, LinearIssue } from "../../src/linear/linearClient.js";
import type { RunRepository } from "../../src/orchestrator/runRepository.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import type { RepoRegistry, RepoEntry } from "../../src/config/repoRegistry.js";
import type { Run } from "../../src/domain/types.js";
import type { Logger } from "../../src/utils/logger.js";

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

function makeMockLinearClient() {
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

function makeMockRunRepo() {
  return {
    findActiveByIssueId: vi.fn(),
  };
}

function makeMockOrchestrator() {
  return {
    startRun: vi.fn(),
  };
}

function makeMockRepoRegistry() {
  return {
    listRepos: vi.fn(),
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "org/repo",
    directory: "repo",
    defaultBranch: "main",
    allowedPaths: [],
    protectedPaths: [],
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 30,
      maxDiffLines: 2000,
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
    branchName: "feature/x",
    state: "Todo",
    labels: [],
    priority: 1,
    ...overrides,
  };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("logs a warning and returns no issues when no repo has linearProject or assigneeMe configured", async () => {
    const linearClient = makeMockLinearClient();
    const runRepo = makeMockRunRepo();
    const orchestrator = makeMockOrchestrator();
    const repoRegistry = makeMockRepoRegistry();
    repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ name: "org/no-linear" })]);
    const logger = makeMockLogger();

    const svc = new LinearPollService(
      linearClient as unknown as LinearClient,
      runRepo as unknown as RunRepository,
      orchestrator as unknown as OrchestratorService,
      repoRegistry as unknown as RepoRegistry,
      logger as unknown as Logger,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
  });

  it("builds one filter per matching repo and searches Linear with the Todo state", async () => {
    const linearClient = makeMockLinearClient();
    const runRepo = makeMockRunRepo();
    const orchestrator = makeMockOrchestrator();
    const repoRegistry = makeMockRepoRegistry();
    repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "org/project-repo", linearProject: "Foundry" }),
      makeRepoEntry({ name: "org/assignee-repo", assigneeMe: true, linearTeam: "ENG" }),
      makeRepoEntry({ name: "org/unrelated" }),
    ]);
    linearClient.searchIssues.mockResolvedValue([]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const logger = makeMockLogger();

    const svc = new LinearPollService(
      linearClient as unknown as LinearClient,
      runRepo as unknown as RunRepository,
      orchestrator as unknown as OrchestratorService,
      repoRegistry as unknown as RepoRegistry,
      logger as unknown as Logger,
    );

    await svc.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenNthCalledWith(1, {
      projectName: "Foundry",
      assigneeMe: undefined,
      team: undefined,
      state: "Todo",
    });
    expect(linearClient.searchIssues).toHaveBeenNthCalledWith(2, {
      projectName: undefined,
      assigneeMe: true,
      team: "ENG",
      state: "Todo",
    });
  });

  it("excludes issues that already have an active run, and dedupes issues seen across filters", async () => {
    const linearClient = makeMockLinearClient();
    const runRepo = makeMockRunRepo();
    const orchestrator = makeMockOrchestrator();
    const repoRegistry = makeMockRepoRegistry();
    repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "repo-a", linearProject: "A" }),
      makeRepoEntry({ name: "repo-b", linearProject: "B" }),
    ]);

    const issueShared = makeIssue({ id: "shared-1" });
    const issueActive = makeIssue({ id: "active-1" });
    const issueNew = makeIssue({ id: "new-1" });

    linearClient.searchIssues
      .mockResolvedValueOnce([issueShared, issueActive])
      .mockResolvedValueOnce([issueShared, issueNew]); // shared-1 appears again -> deduped

    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "active-1" ? ({ id: "run-x" } as unknown as Run) : null),
    );

    const logger = makeMockLogger();
    const svc = new LinearPollService(
      linearClient as unknown as LinearClient,
      runRepo as unknown as RunRepository,
      orchestrator as unknown as OrchestratorService,
      repoRegistry as unknown as RepoRegistry,
      logger as unknown as Logger,
    );

    const result = await svc.discoverPendingIssues();

    // shared-1 candidate accepted only on first encounter, active-1 excluded, new-1 included.
    expect(result.map((i) => i.id)).toEqual(["shared-1", "new-1"]);
    // findActiveByIssueId called once per unique issue id (shared-1 only checked once, not twice).
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ candidateCount: 2 }),
      "Discovered pending Linear issues",
    );
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  function buildService(overrides: {
    findActiveByIssueId?: ReturnType<typeof vi.fn>;
    startRun?: ReturnType<typeof vi.fn>;
  } = {}) {
    const linearClient = makeMockLinearClient();
    const runRepo = makeMockRunRepo();
    if (overrides.findActiveByIssueId) runRepo.findActiveByIssueId = overrides.findActiveByIssueId;
    const orchestrator = makeMockOrchestrator();
    if (overrides.startRun) orchestrator.startRun = overrides.startRun;
    const repoRegistry = makeMockRepoRegistry();
    const logger = makeMockLogger();
    const svc = new LinearPollService(
      linearClient as unknown as LinearClient,
      runRepo as unknown as RunRepository,
      orchestrator as unknown as OrchestratorService,
      repoRegistry as unknown as RepoRegistry,
      logger as unknown as Logger,
    );
    return { svc, runRepo, orchestrator, logger };
  }

  it("skips issues that already have an active run without starting a new one", async () => {
    const findActiveByIssueId = vi.fn().mockResolvedValue({ id: "existing-run" } as unknown as Run);
    const { svc, orchestrator } = buildService({ findActiveByIssueId });

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("starts a run for issues with no active run", async () => {
    const findActiveByIssueId = vi.fn().mockResolvedValue(null);
    const startRun = vi.fn().mockResolvedValue({ id: "new-run" } as unknown as Run);
    const { svc, orchestrator, logger } = buildService({ findActiveByIssueId, startRun });

    const result = await svc.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result).toEqual({ started: ["issue-1", "issue-2"], skipped: [] });
    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-1");
    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-2");
    expect(logger.info).toHaveBeenCalledWith(
      { started: 2, skipped: 0 },
      "Ingested Linear issues",
    );
  });

  it("catches errors from startRun, logs them, and skips the issue", async () => {
    const findActiveByIssueId = vi.fn().mockResolvedValue(null);
    const startRun = vi.fn().mockRejectedValue(new Error("policy violation"));
    const { svc, logger } = buildService({ findActiveByIssueId, startRun });

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "policy violation" },
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error thrown by startRun", async () => {
    const findActiveByIssueId = vi.fn().mockResolvedValue(null);
    const startRun = vi.fn().mockRejectedValue("boom");
    const { svc, logger } = buildService({ findActiveByIssueId, startRun });

    await svc.startRunsForIssues(["issue-1"]);

    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("handles a mix of started and skipped issues in one batch", async () => {
    const findActiveByIssueId = vi.fn().mockImplementation((id: string) =>
      Promise.resolve(id === "has-run" ? ({ id: "r" } as unknown as Run) : null),
    );
    const startRun = vi.fn().mockResolvedValue({} as unknown as Run);
    const { svc, logger } = buildService({ findActiveByIssueId, startRun });

    const result = await svc.startRunsForIssues(["has-run", "fresh"]);

    expect(result).toEqual({ started: ["fresh"], skipped: ["has-run"] });
    expect(logger.info).toHaveBeenCalledWith(
      { started: 1, skipped: 1 },
      "Ingested Linear issues",
    );
  });
});
