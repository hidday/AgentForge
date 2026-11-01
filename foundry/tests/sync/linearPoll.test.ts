import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Issue",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeHarness() {
  const linearClient = { searchIssues: vi.fn() };
  const runRepo = { findActiveByIssueId: vi.fn() };
  const orchestrator = { startRun: vi.fn() };
  const repoRegistry = { listRepos: vi.fn() };
  const logger = makeLogger();
  const service = new LinearPollService(
    linearClient as never,
    runRepo as never,
    orchestrator as never,
    repoRegistry as never,
    logger as never,
  );
  return { service, linearClient, runRepo, orchestrator, repoRegistry, logger };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns an empty array and warns when no repos are configured for Linear polling", async () => {
    const { service, repoRegistry, logger } = makeHarness();
    repoRegistry.listRepos.mockReturnValue([{ repo: "acme/widgets" }]);

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("builds a filter per repo with a linearProject or assigneeMe configured", async () => {
    const { service, repoRegistry, linearClient, runRepo } = makeHarness();
    repoRegistry.listRepos.mockReturnValue([
      { repo: "acme/widgets", linearProject: "Core", linearTeam: "COR" },
      { repo: "acme/other", assigneeMe: true, linearTeam: "OTH" },
      { repo: "acme/unconfigured" },
    ]);
    linearClient.searchIssues.mockResolvedValue([]);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Core",
      assigneeMe: undefined,
      team: "COR",
      state: "Todo",
    });
  });

  it("deduplicates issues seen across multiple filters and excludes issues with an active run", async () => {
    const { service, repoRegistry, linearClient, runRepo } = makeHarness();
    repoRegistry.listRepos.mockReturnValue([
      { repo: "acme/a", linearProject: "Core" },
      { repo: "acme/b", assigneeMe: true },
    ]);
    const shared = makeIssue({ id: "shared-1" });
    const activeRun = makeIssue({ id: "has-run" });
    const fresh = makeIssue({ id: "fresh-1" });
    linearClient.searchIssues
      .mockResolvedValueOnce([shared, activeRun])
      .mockResolvedValueOnce([shared, fresh]);
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "has-run" ? { id: "run-1" } : null),
    );

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id).sort()).toEqual(["fresh-1", "shared-1"]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts runs for issues with no active run and reports them as started", async () => {
    const { service, orchestrator, runRepo } = makeHarness();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockResolvedValue(undefined);

    const result = await service.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result.started).toEqual(["issue-1", "issue-2"]);
    expect(result.skipped).toEqual([]);
    expect(orchestrator.startRun).toHaveBeenCalledTimes(2);
  });

  it("skips an issue that already has an active run without calling startRun", async () => {
    const { service, orchestrator, runRepo } = makeHarness();
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-1" });

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result.started).toEqual([]);
    expect(result.skipped).toEqual(["issue-1"]);
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("skips an issue and logs an error when starting the run throws", async () => {
    const { service, orchestrator, runRepo, logger } = makeHarness();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValue(new Error("boom"));

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result.started).toEqual([]);
    expect(result.skipped).toEqual(["issue-1"]);
    expect(logger.error).toHaveBeenCalled();
  });

  it("stringifies a non-Error thrown value when logging the failure", async () => {
    const { service, orchestrator, runRepo, logger } = makeHarness();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    orchestrator.startRun.mockRejectedValue("a plain string rejection");

    await service.startRunsForIssues(["issue-1"]);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: "a plain string rejection" }),
      expect.any(String),
    );
  });
});
