import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
  };
}

function makeOrchestrator() {
  return {
    startRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  };
}

function makeRepoEntry(overrides: Record<string, unknown> = {}) {
  return {
    name: "acme/repo",
    directory: "/repo",
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

function makeRepoRegistry(repos: ReturnType<typeof makeRepoEntry>[]) {
  return {
    listRepos: vi.fn().mockReturnValue(repos),
    resolveForIssue: vi.fn(),
  };
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Do the thing",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
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

  function makeService(repos: ReturnType<typeof makeRepoEntry>[]) {
    const repoRegistry = makeRepoRegistry(repos);
    return new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );
  }

  it("returns an empty array and warns when no repos are configured for Linear polling", async () => {
    const service = makeService([makeRepoEntry({ linearProject: undefined, assigneeMe: undefined })]);

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds a filter per repo with a linearProject or assigneeMe configured", async () => {
    const service = makeService([
      makeRepoEntry({ name: "a", linearProject: "Backend", linearTeam: "BE" }),
      makeRepoEntry({ name: "b", assigneeMe: true, linearTeam: "FE" }),
      makeRepoEntry({ name: "c" }),
    ]);
    linearClient.searchIssues.mockResolvedValue([]);

    await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Backend",
      assigneeMe: undefined,
      team: "BE",
      state: "Todo",
    });
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: undefined,
      assigneeMe: true,
      team: "FE",
      state: "Todo",
    });
  });

  it("deduplicates issues returned by more than one filter", async () => {
    const service = makeService([
      makeRepoEntry({ name: "a", linearProject: "Backend" }),
      makeRepoEntry({ name: "b", assigneeMe: true }),
    ]);
    const shared = makeIssue({ id: "shared-1" });
    linearClient.searchIssues
      .mockResolvedValueOnce([shared])
      .mockResolvedValueOnce([shared, makeIssue({ id: "unique-1" })]);

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id).sort()).toEqual(["shared-1", "unique-1"]);
  });

  it("excludes issues that already have an active run", async () => {
    const service = makeService([makeRepoEntry({ linearProject: "Backend" })]);
    linearClient.searchIssues.mockResolvedValue([
      makeIssue({ id: "has-run" }),
      makeIssue({ id: "no-run" }),
    ]);
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "has-run" ? { id: "run-1" } : null),
    );

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["no-run"]);
  });

  it("logs the candidate count and filter summary", async () => {
    const service = makeService([makeRepoEntry({ linearProject: "Backend" })]);
    linearClient.searchIssues.mockResolvedValue([makeIssue()]);

    await service.discoverPendingIssues();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ candidateCount: 1 }),
      "Discovered pending Linear issues",
    );
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  let linearClient: ReturnType<typeof makeLinearClient>;
  let runRepo: ReturnType<typeof makeRunRepo>;
  let orchestrator: ReturnType<typeof makeOrchestrator>;
  let logger: ReturnType<typeof makeLogger>;
  let service: LinearPollService;

  beforeEach(() => {
    linearClient = makeLinearClient();
    runRepo = makeRunRepo();
    orchestrator = makeOrchestrator();
    logger = makeLogger();
    const repoRegistry = makeRepoRegistry([]);
    service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );
  });

  it("starts a run for each issue id and reports it as started", async () => {
    const result = await service.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result.started).toEqual(["issue-1", "issue-2"]);
    expect(result.skipped).toEqual([]);
    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-1");
    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-2");
  });

  it("skips issues that already have an active run without calling startRun", async () => {
    runRepo.findActiveByIssueId.mockResolvedValueOnce({ id: "existing-run" });

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result.skipped).toEqual(["issue-1"]);
    expect(result.started).toEqual([]);
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("skips and logs an error when startRun throws", async () => {
    orchestrator.startRun.mockRejectedValueOnce(new Error("boom"));

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result.skipped).toEqual(["issue-1"]);
    expect(result.started).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "issue-1", error: "boom" }),
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error rejection value when logging the failure", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    orchestrator.startRun.mockRejectedValueOnce("plain string failure");

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result.skipped).toEqual(["issue-1"]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "issue-1", error: "plain string failure" }),
      "Failed to start run for issue",
    );
  });

  it("handles an empty list of issue ids", async () => {
    const result = await service.startRunsForIssues([]);

    expect(result).toEqual({ started: [], skipped: [] });
    expect(logger.info).toHaveBeenCalledWith(
      { started: 0, skipped: 0 },
      "Ingested Linear issues",
    );
  });
});
