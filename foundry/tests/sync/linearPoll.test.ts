import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearClient, LinearIssue } from "../../src/linear/linearClient.js";
import type { RunRepository } from "../../src/orchestrator/runRepository.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import type { RepoRegistry } from "../../src/config/repoRegistry.js";
import type { Logger } from "../../src/utils/logger.js";
import type { Run } from "../../src/domain/types.js";
import { RunState } from "../../src/domain/runState.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "lin-1",
    identifier: "ENG-1",
    title: "Fix bug",
    description: "desc",
    branchName: "ai/lin-1",
    state: "Todo",
    labels: [],
    priority: 1,
    ...overrides,
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "lin-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
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

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

function buildService(opts: {
  repos?: unknown[];
  searchIssuesImpl?: (filter: unknown) => Promise<LinearIssue[]>;
  findActiveByIssueIdImpl?: (id: string) => Promise<Run | null>;
  startRunImpl?: (id: string) => Promise<Run>;
}) {
  const logger = makeLogger();

  const linearClient = {
    searchIssues: vi.fn(opts.searchIssuesImpl ?? (() => Promise.resolve([]))),
  } as unknown as LinearClient;

  const runRepo = {
    findActiveByIssueId: vi.fn(opts.findActiveByIssueIdImpl ?? (() => Promise.resolve(null))),
  } as unknown as RunRepository;

  const orchestrator = {
    startRun: vi.fn(opts.startRunImpl ?? ((id: string) => Promise.resolve(makeRun({ linearIssueId: id })))),
  } as unknown as OrchestratorService;

  const repoRegistry = {
    listRepos: vi.fn().mockReturnValue(opts.repos ?? []),
  } as unknown as RepoRegistry;

  const svc = new LinearPollService(linearClient, runRepo, orchestrator, repoRegistry, logger);
  return { svc, linearClient, runRepo, orchestrator, repoRegistry, logger };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns an empty array and warns when no repos have linearProject or assigneeMe configured", async () => {
    const { svc, linearClient, logger } = buildService({
      repos: [{ name: "repo-a" }, { name: "repo-b", linearProject: undefined, assigneeMe: false }],
    });

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
  });

  it("builds one search filter per eligible repo and searches with Todo state", async () => {
    const { svc, linearClient } = buildService({
      repos: [
        { name: "repo-a", linearProject: "proj-a" },
        { name: "repo-b", assigneeMe: true, linearTeam: "team-b" },
        { name: "repo-c" },
      ],
    });

    await svc.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "proj-a",
      assigneeMe: undefined,
      team: undefined,
      state: "Todo",
    });
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: undefined,
      assigneeMe: true,
      team: "team-b",
      state: "Todo",
    });
  });

  it("excludes issues that already have an active run", async () => {
    const issue1 = makeIssue({ id: "lin-1" });
    const issue2 = makeIssue({ id: "lin-2" });
    const { svc } = buildService({
      repos: [{ name: "repo-a", linearProject: "proj-a" }],
      searchIssuesImpl: () => Promise.resolve([issue1, issue2]),
      findActiveByIssueIdImpl: (id) =>
        Promise.resolve(id === "lin-1" ? makeRun({ linearIssueId: "lin-1" }) : null),
    });

    const result = await svc.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["lin-2"]);
  });

  it("dedupes issues seen across multiple repo filters", async () => {
    const sharedIssue = makeIssue({ id: "lin-shared" });
    let callCount = 0;
    const { svc, linearClient } = buildService({
      repos: [
        { name: "repo-a", linearProject: "proj-a" },
        { name: "repo-b", linearProject: "proj-b" },
      ],
      searchIssuesImpl: () => {
        callCount += 1;
        return Promise.resolve([sharedIssue]);
      },
    });

    const result = await svc.discoverPendingIssues();

    expect(callCount).toBe(2);
    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("lin-shared");
  });

  it("logs the candidate count and filter summary", async () => {
    const { svc, logger } = buildService({
      repos: [{ name: "repo-a", linearProject: "proj-a" }],
      searchIssuesImpl: () => Promise.resolve([makeIssue()]),
    });

    await svc.discoverPendingIssues();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateCount: 1,
        filters: [{ project: "proj-a", assigneeMe: undefined, team: undefined }],
      }),
      "Discovered pending Linear issues",
    );
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue id and reports it as started", async () => {
    const { svc, orchestrator } = buildService({});

    const result = await svc.startRunsForIssues(["lin-1", "lin-2"]);

    expect(result.started).toEqual(["lin-1", "lin-2"]);
    expect(result.skipped).toEqual([]);
    expect(orchestrator.startRun).toHaveBeenCalledWith("lin-1");
    expect(orchestrator.startRun).toHaveBeenCalledWith("lin-2");
  });

  it("skips an issue that already has an active run without calling startRun", async () => {
    const { svc, orchestrator } = buildService({
      findActiveByIssueIdImpl: (id) =>
        Promise.resolve(id === "lin-1" ? makeRun({ linearIssueId: "lin-1" }) : null),
    });

    const result = await svc.startRunsForIssues(["lin-1", "lin-2"]);

    expect(result.skipped).toEqual(["lin-1"]);
    expect(result.started).toEqual(["lin-2"]);
    expect(orchestrator.startRun).toHaveBeenCalledTimes(1);
    expect(orchestrator.startRun).toHaveBeenCalledWith("lin-2");
  });

  it("catches a startRun failure, logs an error, and marks the issue as skipped rather than throwing", async () => {
    const error = new Error("boom");
    const { svc, logger } = buildService({
      startRunImpl: (id) => (id === "lin-1" ? Promise.reject(error) : Promise.resolve(makeRun())),
    });

    const result = await svc.startRunsForIssues(["lin-1", "lin-2"]);

    expect(result.skipped).toEqual(["lin-1"]);
    expect(result.started).toEqual(["lin-2"]);
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "lin-1", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error thrown value in the failure log", async () => {
    const { svc, logger } = buildService({
      startRunImpl: () => Promise.reject("weird failure"),
    });

    await svc.startRunsForIssues(["lin-1"]);

    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "lin-1", error: "weird failure" },
      "Failed to start run for issue",
    );
  });

  it("logs the started/skipped summary counts", async () => {
    const { svc, logger } = buildService({
      findActiveByIssueIdImpl: (id) =>
        Promise.resolve(id === "lin-1" ? makeRun({ linearIssueId: "lin-1" }) : null),
    });

    await svc.startRunsForIssues(["lin-1", "lin-2"]);

    expect(logger.info).toHaveBeenCalledWith(
      { started: 1, skipped: 1 },
      "Ingested Linear issues",
    );
  });

  it("returns empty started/skipped arrays for an empty input list", async () => {
    const { svc, orchestrator } = buildService({});

    const result = await svc.startRunsForIssues([]);

    expect(result).toEqual({ started: [], skipped: [] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });
});
