import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";
import type { Run } from "../../src/domain/types.js";
import { RunState } from "../../src/domain/runState.js";

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

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "/tmp/repo-a",
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

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "repo-a",
    branchName: null,
    prNumber: null,
    state: RunState.Planning,
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

function buildDeps() {
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
  };

  const orchestrator = {
    startRun: vi.fn().mockResolvedValue(makeRun()),
  };

  const repoRegistry = {
    listRepos: vi.fn().mockReturnValue([]),
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn(),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return { linearClient, runRepo, orchestrator, repoRegistry, logger };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("warns and returns an empty array when no repos are configured for Linear polling", async () => {
    const { linearClient, runRepo, orchestrator, repoRegistry, logger } = buildDeps();
    repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "no-linear", linearProject: undefined, assigneeMe: undefined }),
    ]);
    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
  });

  it("builds a filter per eligible repo (linearProject or assigneeMe) and returns new candidates", async () => {
    const { linearClient, runRepo, orchestrator, repoRegistry, logger } = buildDeps();
    repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "proj-repo", linearProject: "Project X", linearTeam: undefined }),
      makeRepoEntry({
        name: "assignee-repo",
        linearProject: undefined,
        assigneeMe: true,
        linearTeam: "ENG",
      }),
      makeRepoEntry({ name: "irrelevant-repo", linearProject: undefined, assigneeMe: undefined }),
    ]);

    const issueA = makeIssue({ id: "a" });
    const issueB = makeIssue({ id: "b" });
    linearClient.searchIssues.mockResolvedValueOnce([issueA]).mockResolvedValueOnce([issueB]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenNthCalledWith(1, {
      projectName: "Project X",
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

    expect(result).toEqual([issueA, issueB]);
    expect(logger.info).toHaveBeenCalledWith(
      {
        candidateCount: 2,
        filters: [
          { project: "Project X", assigneeMe: undefined, team: undefined },
          { project: undefined, assigneeMe: true, team: "ENG" },
        ],
      },
      "Discovered pending Linear issues",
    );
  });

  it("deduplicates issues seen across multiple filters and skips issues that already have an active run", async () => {
    const { linearClient, runRepo, orchestrator, repoRegistry, logger } = buildDeps();
    repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "repo-a", linearProject: "Proj A" }),
      makeRepoEntry({ name: "repo-b", linearProject: "Proj B" }),
    ]);

    const shared = makeIssue({ id: "shared" });
    const alreadyRunning = makeIssue({ id: "already-running" });
    const fresh = makeIssue({ id: "fresh" });

    linearClient.searchIssues
      .mockResolvedValueOnce([shared, alreadyRunning])
      .mockResolvedValueOnce([shared, fresh]);

    runRepo.findActiveByIssueId.mockImplementation((issueId: string) =>
      Promise.resolve(issueId === "already-running" ? makeRun({ id: "existing-run" }) : null),
    );

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.discoverPendingIssues();

    // "shared" is only checked/counted once thanks to the seenIds de-dup.
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(3);
    expect(result.map((i) => i.id)).toEqual(["shared", "fresh"]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue with no active run and reports it as started", async () => {
    const { linearClient, runRepo, orchestrator, repoRegistry, logger } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockResolvedValue(makeRun());

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-1");
    expect(result).toEqual({ started: ["issue-1"], skipped: [] });
    expect(logger.info).toHaveBeenCalledWith({ started: 1, skipped: 0 }, "Ingested Linear issues");
  });

  it("skips an issue that already has an active run without starting a new one", async () => {
    const { linearClient, runRepo, orchestrator, repoRegistry, logger } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(makeRun());

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(orchestrator.startRun).not.toHaveBeenCalled();
    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
  });

  it("catches an error from orchestrator.startRun, logs it, and marks the issue skipped", async () => {
    const { linearClient, runRepo, orchestrator, repoRegistry, logger } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const error = new Error("boom");
    orchestrator.startRun.mockRejectedValue(error);

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error thrown value when logging the failure", async () => {
    const { linearClient, runRepo, orchestrator, repoRegistry, logger } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValue("plain string failure");

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result.skipped).toEqual(["issue-1"]);
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "plain string failure" },
      "Failed to start run for issue",
    );
  });

  it("handles a mix of started and skipped issues, and an empty list", async () => {
    const { linearClient, runRepo, orchestrator, repoRegistry, logger } = buildDeps();
    runRepo.findActiveByIssueId.mockImplementation((issueId: string) =>
      Promise.resolve(issueId === "busy" ? makeRun() : null),
    );
    orchestrator.startRun.mockResolvedValue(makeRun());

    const svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await svc.startRunsForIssues(["fresh-1", "busy", "fresh-2"]);
    expect(result).toEqual({ started: ["fresh-1", "fresh-2"], skipped: ["busy"] });

    const emptyResult = await svc.startRunsForIssues([]);
    expect(emptyResult).toEqual({ started: [], skipped: [] });
    expect(logger.info).toHaveBeenCalledWith({ started: 0, skipped: 0 }, "Ingested Linear issues");
  });
});
