import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearClient, LinearIssue } from "../../src/linear/linearClient.js";
import type { RunRepository } from "../../src/orchestrator/runRepository.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import type { RepoRegistry, RepoEntry } from "../../src/config/repoRegistry.js";
import type { Run } from "../../src/domain/types.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "iss-1",
    identifier: "ENG-1",
    title: "Fix the bug",
    description: "desc",
    branchName: "ai/eng-1",
    state: "Todo",
    labels: [],
    priority: 2,
    ...overrides,
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "acme/backend",
    directory: "/tmp/acme",
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

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeDeps() {
  const linearClient = { searchIssues: vi.fn().mockResolvedValue([]) };
  const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
  const orchestrator = { startRun: vi.fn().mockResolvedValue({ id: "run-x" } as unknown as Run) };
  const repoRegistry = { listRepos: vi.fn().mockReturnValue([]) };
  const logger = makeLogger();

  const service = new LinearPollService(
    linearClient as unknown as LinearClient,
    runRepo as unknown as RunRepository,
    orchestrator as unknown as OrchestratorService,
    repoRegistry as unknown as RepoRegistry,
    logger as never,
  );

  return { service, linearClient, runRepo, orchestrator, repoRegistry, logger };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns no candidates and warns when no repo is configured for polling", async () => {
    const { service, repoRegistry, logger, linearClient } = makeDeps();
    repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ linearProject: undefined, assigneeMe: undefined })]);

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds one search filter per configured repo and queries with state Todo", async () => {
    const { service, repoRegistry, linearClient } = makeDeps();
    repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "repo-a", linearProject: "Backend Platform", linearTeam: "ENG" }),
      makeRepoEntry({ name: "repo-b", assigneeMe: true }),
      makeRepoEntry({ name: "repo-c", linearProject: undefined, assigneeMe: undefined }),
    ]);
    linearClient.searchIssues.mockResolvedValue([]);

    await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Backend Platform",
      assigneeMe: undefined,
      team: "ENG",
      state: "Todo",
    });
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: undefined,
      assigneeMe: true,
      team: undefined,
      state: "Todo",
    });
  });

  it("excludes issues that already have an active run", async () => {
    const { service, repoRegistry, linearClient, runRepo } = makeDeps();
    repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ assigneeMe: true })]);
    const issue = makeIssue({ id: "iss-1" });
    linearClient.searchIssues.mockResolvedValue([issue]);
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "existing-run" } as unknown as Run);

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
  });

  it("includes issues with no active run", async () => {
    const { service, repoRegistry, linearClient, runRepo } = makeDeps();
    repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ assigneeMe: true })]);
    const issue = makeIssue({ id: "iss-2" });
    linearClient.searchIssues.mockResolvedValue([issue]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([issue]);
  });

  it("de-duplicates issues returned by multiple overlapping filters", async () => {
    const { service, repoRegistry, linearClient } = makeDeps();
    repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "repo-a", linearProject: "Proj" }),
      makeRepoEntry({ name: "repo-b", assigneeMe: true }),
    ]);
    const sharedIssue = makeIssue({ id: "shared-1" });
    linearClient.searchIssues.mockResolvedValue([sharedIssue]);

    const result = await service.discoverPendingIssues();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("shared-1");
  });

  it("logs a summary with the candidate count and filter shapes", async () => {
    const { service, repoRegistry, linearClient, logger } = makeDeps();
    repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ assigneeMe: true, linearTeam: "ENG" })]);
    linearClient.searchIssues.mockResolvedValue([makeIssue()]);

    await service.discoverPendingIssues();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateCount: 1,
        filters: [{ project: undefined, assigneeMe: true, team: "ENG" }],
      }),
      "Discovered pending Linear issues",
    );
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue without an existing active run", async () => {
    const { service, orchestrator, runRepo } = makeDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const result = await service.startRunsForIssues(["iss-1", "iss-2"]);

    expect(orchestrator.startRun).toHaveBeenCalledWith("iss-1");
    expect(orchestrator.startRun).toHaveBeenCalledWith("iss-2");
    expect(result.started).toEqual(["iss-1", "iss-2"]);
    expect(result.skipped).toEqual([]);
  });

  it("skips an issue that already has an active run without starting a new one", async () => {
    const { service, orchestrator, runRepo } = makeDeps();
    runRepo.findActiveByIssueId.mockResolvedValueOnce({ id: "existing" } as unknown as Run);

    const result = await service.startRunsForIssues(["iss-1"]);

    expect(orchestrator.startRun).not.toHaveBeenCalled();
    expect(result.skipped).toEqual(["iss-1"]);
    expect(result.started).toEqual([]);
  });

  it("isolates a failure starting one run: it is skipped and logged, other issues still processed", async () => {
    const { service, orchestrator, runRepo, logger } = makeDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun
      .mockRejectedValueOnce(new Error("planner unavailable"))
      .mockResolvedValueOnce({ id: "run-2" } as unknown as Run);

    const result = await service.startRunsForIssues(["bad-issue", "good-issue"]);

    expect(result.skipped).toEqual(["bad-issue"]);
    expect(result.started).toEqual(["good-issue"]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "bad-issue", error: "planner unavailable" }),
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error thrown value when logging the failure", async () => {
    const { service, orchestrator, runRepo, logger } = makeDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    orchestrator.startRun.mockRejectedValueOnce("boom");

    const result = await service.startRunsForIssues(["iss-1"]);

    expect(result.skipped).toEqual(["iss-1"]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "iss-1", error: "boom" }),
      "Failed to start run for issue",
    );
  });

  it("logs a started/skipped summary count", async () => {
    const { service, orchestrator, runRepo, logger } = makeDeps();
    runRepo.findActiveByIssueId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "existing" } as unknown as Run);
    orchestrator.startRun.mockResolvedValueOnce({ id: "run-1" } as unknown as Run);

    await service.startRunsForIssues(["iss-1", "iss-2"]);

    expect(logger.info).toHaveBeenCalledWith(
      { started: 1, skipped: 1 },
      "Ingested Linear issues",
    );
  });
});
