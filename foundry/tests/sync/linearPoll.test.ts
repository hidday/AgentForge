import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Title",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "widgets",
    directory: "widgets",
    defaultBranch: "main",
    allowedPaths: [],
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

function makeServices() {
  const linearClient = { searchIssues: vi.fn() };
  const runRepo = { findActiveByIssueId: vi.fn() };
  const orchestrator = { startRun: vi.fn() };
  const repoRegistry = { listRepos: vi.fn() };
  const logger = makeLogger();
  const svc = new LinearPollService(
    linearClient as never,
    runRepo as never,
    orchestrator as never,
    repoRegistry as never,
    logger as never,
  );
  return { svc, linearClient, runRepo, orchestrator, repoRegistry, logger };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("warns and returns [] when no repos are configured with linearProject or assigneeMe", async () => {
    const { svc, repoRegistry, logger } = makeServices();
    repoRegistry.listRepos.mockReturnValue([makeRepoEntry()]);

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("builds one filter per matching repo and returns candidates with no active run", async () => {
    const { svc, repoRegistry, linearClient, runRepo } = makeServices();
    repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "a", linearProject: "Alpha" }),
      makeRepoEntry({ name: "b", assigneeMe: true, linearTeam: "PRY" }),
      makeRepoEntry({ name: "c" }),
    ]);
    const issueA = makeIssue({ id: "issue-a" });
    const issueB = makeIssue({ id: "issue-b" });
    linearClient.searchIssues.mockResolvedValueOnce([issueA]).mockResolvedValueOnce([issueB]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const result = await svc.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenNthCalledWith(1, {
      projectName: "Alpha",
      assigneeMe: undefined,
      team: undefined,
      state: "Todo",
    });
    expect(linearClient.searchIssues).toHaveBeenNthCalledWith(2, {
      projectName: undefined,
      assigneeMe: true,
      team: "PRY",
      state: "Todo",
    });
    expect(result.map((i) => i.id)).toEqual(["issue-a", "issue-b"]);
  });

  it("excludes issues that already have an active run", async () => {
    const { svc, repoRegistry, linearClient, runRepo } = makeServices();
    repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ linearProject: "Alpha" })]);
    linearClient.searchIssues.mockResolvedValue([makeIssue({ id: "issue-a" })]);
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-existing" });

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
  });

  it("dedupes an issue id that shows up from more than one filter", async () => {
    const { svc, repoRegistry, linearClient, runRepo } = makeServices();
    repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "a", linearProject: "Alpha" }),
      makeRepoEntry({ name: "b", linearProject: "Beta" }),
    ]);
    const sharedIssue = makeIssue({ id: "issue-shared" });
    linearClient.searchIssues.mockResolvedValue([sharedIssue]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const result = await svc.discoverPendingIssues();

    expect(result).toHaveLength(1);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue id with no existing active run", async () => {
    const { svc, runRepo, orchestrator } = makeServices();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockResolvedValue({ id: "run-1" });

    const result = await svc.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result.started).toEqual(["issue-1", "issue-2"]);
    expect(result.skipped).toEqual([]);
    expect(orchestrator.startRun).toHaveBeenCalledTimes(2);
  });

  it("skips an issue id that already has an active run without calling startRun", async () => {
    const { svc, runRepo, orchestrator } = makeServices();
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-existing" });

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result.started).toEqual([]);
    expect(result.skipped).toEqual(["issue-1"]);
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("catches an orchestrator failure, logs it, and records the issue as skipped", async () => {
    const { svc, runRepo, orchestrator, logger } = makeServices();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValue(new Error("boom"));

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result.started).toEqual([]);
    expect(result.skipped).toEqual(["issue-1"]);
    expect(logger.error).toHaveBeenCalled();
  });

  it("stringifies a non-Error thrown value when logging the failure", async () => {
    const { svc, runRepo, orchestrator, logger } = makeServices();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    orchestrator.startRun.mockRejectedValue("plain string failure");

    const result = await svc.startRunsForIssues(["issue-1"]);

    expect(result.skipped).toEqual(["issue-1"]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: "plain string failure" }),
      "Failed to start run for issue",
    );
  });

  it("handles a mix of started and skipped issues", async () => {
    const { svc, runRepo, orchestrator } = makeServices();
    runRepo.findActiveByIssueId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "run-existing" });
    orchestrator.startRun.mockResolvedValue({ id: "run-1" });

    const result = await svc.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result.started).toEqual(["issue-1"]);
    expect(result.skipped).toEqual(["issue-2"]);
  });
});
