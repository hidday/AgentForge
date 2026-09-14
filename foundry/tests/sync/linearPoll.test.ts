import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Fix it",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeDeps() {
  const linearClient = { searchIssues: vi.fn() };
  const runRepo = { findActiveByIssueId: vi.fn() };
  const orchestrator = { startRun: vi.fn() };
  const repoRegistry = { listRepos: vi.fn() };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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
  it("returns [] and logs a warning when no repos have linearProject or assigneeMe configured", async () => {
    const { svc, repoRegistry, logger, linearClient } = makeDeps();
    repoRegistry.listRepos.mockReturnValue([{ repo: "acme/widgets" }]);

    const result = await svc.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds one filter per qualifying repo (linearProject or assigneeMe) and searches with state=Todo", async () => {
    const { svc, repoRegistry, linearClient, runRepo } = makeDeps();
    repoRegistry.listRepos.mockReturnValue([
      { repo: "a", linearProject: "Alpha", linearTeam: "ALP" },
      { repo: "b", assigneeMe: true, linearTeam: "BET" },
      { repo: "c" }, // excluded: neither linearProject nor assigneeMe
    ]);
    linearClient.searchIssues.mockResolvedValue([]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Alpha",
      assigneeMe: undefined,
      team: "ALP",
      state: "Todo",
    });
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: undefined,
      assigneeMe: true,
      team: "BET",
      state: "Todo",
    });
  });

  it("excludes issues that already have an active run", async () => {
    const { svc, repoRegistry, linearClient, runRepo } = makeDeps();
    repoRegistry.listRepos.mockReturnValue([{ repo: "a", linearProject: "Alpha" }]);
    linearClient.searchIssues.mockResolvedValue([
      makeIssue({ id: "i1" }),
      makeIssue({ id: "i2" }),
    ]);
    runRepo.findActiveByIssueId.mockImplementation(async (id: string) =>
      id === "i1" ? { id: "run-1" } : null,
    );

    const result = await svc.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["i2"]);
  });

  it("deduplicates issues that appear across multiple filters", async () => {
    const { svc, repoRegistry, linearClient, runRepo } = makeDeps();
    repoRegistry.listRepos.mockReturnValue([
      { repo: "a", linearProject: "Alpha" },
      { repo: "b", assigneeMe: true },
    ]);
    const shared = makeIssue({ id: "shared-1" });
    linearClient.searchIssues
      .mockResolvedValueOnce([shared])
      .mockResolvedValueOnce([shared]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const result = await svc.discoverPendingIssues();

    expect(result).toHaveLength(1);
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(1);
  });

  it("logs the candidate count and filter summary", async () => {
    const { svc, repoRegistry, linearClient, runRepo, logger } = makeDeps();
    repoRegistry.listRepos.mockReturnValue([{ repo: "a", linearProject: "Alpha", linearTeam: "A" }]);
    linearClient.searchIssues.mockResolvedValue([makeIssue()]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.discoverPendingIssues();

    expect(logger.info).toHaveBeenCalledWith(
      {
        candidateCount: 1,
        filters: [{ project: "Alpha", assigneeMe: undefined, team: "A" }],
      },
      "Discovered pending Linear issues",
    );
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue without an existing active run", async () => {
    const { svc, runRepo, orchestrator } = makeDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockResolvedValue({ id: "run-new" });

    const result = await svc.startRunsForIssues(["i1", "i2"]);

    expect(result.started).toEqual(["i1", "i2"]);
    expect(result.skipped).toEqual([]);
    expect(orchestrator.startRun).toHaveBeenCalledWith("i1");
    expect(orchestrator.startRun).toHaveBeenCalledWith("i2");
  });

  it("skips an issue that already has an active run without calling startRun", async () => {
    const { svc, runRepo, orchestrator } = makeDeps();
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "existing-run" });

    const result = await svc.startRunsForIssues(["i1"]);

    expect(result.skipped).toEqual(["i1"]);
    expect(result.started).toEqual([]);
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("catches a startRun failure, logs it, and records the issue as skipped (continuing with the rest)", async () => {
    const { svc, runRepo, orchestrator, logger } = makeDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun
      .mockRejectedValueOnce(new Error("plan generation failed"))
      .mockResolvedValueOnce({ id: "run-ok" });

    const result = await svc.startRunsForIssues(["bad", "good"]);

    expect(result.skipped).toEqual(["bad"]);
    expect(result.started).toEqual(["good"]);
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "bad", error: "plan generation failed" },
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error thrown from startRun", async () => {
    const { svc, runRepo, orchestrator, logger } = makeDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValue("plain string failure");

    await svc.startRunsForIssues(["bad"]);

    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "bad", error: "plain string failure" },
      "Failed to start run for issue",
    );
  });

  it("logs a summary with started/skipped counts", async () => {
    const { svc, runRepo, orchestrator, logger } = makeDeps();
    runRepo.findActiveByIssueId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "existing" });
    orchestrator.startRun.mockResolvedValue({ id: "run-ok" });

    await svc.startRunsForIssues(["i1", "i2"]);

    expect(logger.info).toHaveBeenCalledWith(
      { started: 1, skipped: 1 },
      "Ingested Linear issues",
    );
  });

  it("returns empty started/skipped for an empty issueIds array", async () => {
    const { svc } = makeDeps();
    const result = await svc.startRunsForIssues([]);
    expect(result).toEqual({ started: [], skipped: [] });
  });
});
