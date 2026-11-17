import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeIssue(id: string): never {
  return {
    id,
    title: `Issue ${id}`,
    description: "desc",
    branchName: `ai/${id}`,
    state: "Todo",
    labels: [],
    priority: 0,
  } as never;
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("warns and returns an empty list when the repo registry has no linearProject or assigneeMe repos", async () => {
    const logger = makeLogger();
    const linearClient = { searchIssues: vi.fn() };
    const runRepo = { findActiveByIssueId: vi.fn() };
    const orchestrator = { startRun: vi.fn() };
    const repoRegistry = { listRepos: vi.fn().mockReturnValue([{ name: "repo-without-linear" }]) };
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds a filter per configured repo, dedupes issues seen across filters, and skips issues with an active run", async () => {
    const linearClient = {
      searchIssues: vi
        .fn()
        .mockResolvedValueOnce([makeIssue("i1"), makeIssue("i2")])
        .mockResolvedValueOnce([makeIssue("i2"), makeIssue("i3")]),
    };
    const runRepo = {
      findActiveByIssueId: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(id === "i2" ? { id: "run-existing" } : null),
      ),
    };
    const repoRegistry = {
      listRepos: vi.fn().mockReturnValue([
        { name: "repo-a", linearProject: "Core" },
        { name: "repo-b", assigneeMe: true },
      ]),
    };
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      { startRun: vi.fn() } as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const result = await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(result.map((i) => i.id)).toEqual(["i1", "i3"]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for a new issue and reports it in 'started'", async () => {
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = { startRun: vi.fn().mockResolvedValue(undefined) };
    const service = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      makeLogger() as never,
    );

    const result = await service.startRunsForIssues(["i1"]);

    expect(result).toEqual({ started: ["i1"], skipped: [] });
    expect(orchestrator.startRun).toHaveBeenCalledWith("i1");
  });

  it("skips an issue that already has an active run without calling startRun", async () => {
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue({ id: "run-existing" }) };
    const orchestrator = { startRun: vi.fn() };
    const service = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      makeLogger() as never,
    );

    const result = await service.startRunsForIssues(["i1"]);

    expect(result).toEqual({ started: [], skipped: ["i1"] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("catches a startRun failure, logs it, and reports the issue as skipped", async () => {
    const logger = makeLogger();
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = { startRun: vi.fn().mockRejectedValue(new Error("boom")) };
    const service = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      logger as never,
    );

    const result = await service.startRunsForIssues(["i1"]);

    expect(result).toEqual({ started: [], skipped: ["i1"] });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "i1", error: "boom" }),
      expect.any(String),
    );
  });
});
