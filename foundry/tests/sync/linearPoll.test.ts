import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeLinearClient() {
  return { searchIssues: vi.fn() };
}

function makeRunRepo() {
  return { findActiveByIssueId: vi.fn() };
}

function makeOrchestrator() {
  return { startRun: vi.fn() };
}

function makeRepoRegistry(repos: Partial<RepoEntry>[]) {
  return { listRepos: vi.fn().mockReturnValue(repos) };
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
    identifier: "PRY-1",
    title: "Test issue",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("LinearPollService.discoverPendingIssues", () => {
  let logger: ReturnType<typeof makeLogger>;
  let linearClient: ReturnType<typeof makeLinearClient>;
  let runRepo: ReturnType<typeof makeRunRepo>;
  let orchestrator: ReturnType<typeof makeOrchestrator>;

  beforeEach(() => {
    logger = makeLogger();
    linearClient = makeLinearClient();
    runRepo = makeRunRepo();
    orchestrator = makeOrchestrator();
  });

  function makeService(repos: Partial<RepoEntry>[]) {
    return new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      makeRepoRegistry(repos) as never,
      logger as never,
    );
  }

  it("returns an empty array and logs a warning when no repo is configured for polling", async () => {
    const svc = makeService([makeRepoEntry({ linearProject: undefined, assigneeMe: undefined })]);

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds one search filter per repo with a linearProject or assigneeMe configured", async () => {
    linearClient.searchIssues.mockResolvedValue([]);
    const svc = makeService([
      makeRepoEntry({ name: "a", linearProject: "Foundry", linearTeam: "FND" }),
      makeRepoEntry({ name: "b", assigneeMe: true, linearTeam: "PRY" }),
      makeRepoEntry({ name: "c" }),
    ]);

    await svc.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Foundry",
      assigneeMe: undefined,
      team: "FND",
      state: "Todo",
    });
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: undefined,
      assigneeMe: true,
      team: "PRY",
      state: "Todo",
    });
  });

  it("excludes issues that already have an active run", async () => {
    linearClient.searchIssues.mockResolvedValue([
      makeIssue({ id: "issue-1" }),
      makeIssue({ id: "issue-2" }),
    ]);
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "issue-1" ? { id: "run-1" } : null),
    );
    const svc = makeService([makeRepoEntry({ linearProject: "Foundry" })]);

    const result = await svc.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["issue-2"]);
  });

  it("de-duplicates issues seen across multiple repo filters", async () => {
    linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "issue-1" })]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = makeService([
      makeRepoEntry({ name: "a", linearProject: "Foundry" }),
      makeRepoEntry({ name: "b", assigneeMe: true }),
    ]);

    const result = await svc.discoverPendingIssues();

    expect(result).toHaveLength(1);
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(1);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  let logger: ReturnType<typeof makeLogger>;
  let linearClient: ReturnType<typeof makeLinearClient>;
  let runRepo: ReturnType<typeof makeRunRepo>;
  let orchestrator: ReturnType<typeof makeOrchestrator>;
  let svc: LinearPollService;

  beforeEach(() => {
    logger = makeLogger();
    linearClient = makeLinearClient();
    runRepo = makeRunRepo();
    orchestrator = makeOrchestrator();
    svc = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      makeRepoRegistry([makeRepoEntry({ linearProject: "Foundry" })]) as never,
      logger as never,
    );
  });

  it("starts a run for each issue without an active run", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockResolvedValue({ id: "run-1" });

    const result = await svc.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result).toEqual({ started: ["issue-1", "issue-2"], skipped: [] });
    expect(orchestrator.startRun).toHaveBeenCalledTimes(2);
  });

  it("skips an issue that already has an active run without starting it", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "existing-run" });

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("skips and logs an error when starting a run throws", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValue(new Error("boom"));

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error thrown value when logging the failure", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValue("plain string failure");

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "plain string failure" },
      "Failed to start run for issue",
    );
  });

  it("handles a mix of started and skipped issues in one call", async () => {
    runRepo.findActiveByIssueId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "existing" });
    orchestrator.startRun.mockResolvedValue({ id: "run-1" });

    const result = await svc.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result).toEqual({ started: ["issue-1"], skipped: ["issue-2"] });
  });
});
