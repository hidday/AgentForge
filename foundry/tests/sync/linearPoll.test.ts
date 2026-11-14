import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    title: "Issue",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("warns and returns no candidates when no repos are configured for polling", async () => {
    const logger = makeLogger();
    const linearClient = { searchIssues: vi.fn() };
    const runRepo = { findActiveByIssueId: vi.fn() };
    const repoRegistry = { listRepos: vi.fn().mockReturnValue([{ name: "r1" }]) };
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      {} as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds a filter per project/assigneeMe repo and returns issues without an active run", async () => {
    const linearClient = {
      searchIssues: vi
        .fn()
        .mockResolvedValueOnce([makeIssue({ id: "a" }), makeIssue({ id: "b" })])
        .mockResolvedValueOnce([makeIssue({ id: "c" })]),
    };
    const runRepo = {
      findActiveByIssueId: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(id === "b" ? { id: "run-b" } : null),
      ),
    };
    const repoRegistry = {
      listRepos: vi.fn().mockReturnValue([
        { name: "r1", linearProject: "Project A" },
        { name: "r2", assigneeMe: true, linearTeam: "TEAM" },
        { name: "r3" },
      ]),
    };
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      {} as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const candidates = await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(candidates.map((c) => c.id).sort()).toEqual(["a", "c"]);
  });

  it("de-duplicates issues seen across multiple filters", async () => {
    const linearClient = {
      searchIssues: vi
        .fn()
        .mockResolvedValueOnce([makeIssue({ id: "a" })])
        .mockResolvedValueOnce([makeIssue({ id: "a" })]),
    };
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const repoRegistry = {
      listRepos: vi.fn().mockReturnValue([
        { name: "r1", linearProject: "Project A" },
        { name: "r2", linearProject: "Project B" },
      ]),
    };
    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      {} as never,
      repoRegistry as never,
      makeLogger() as never,
    );

    const candidates = await service.discoverPendingIssues();

    expect(candidates).toHaveLength(1);
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(1);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue without an active run", async () => {
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = { startRun: vi.fn().mockResolvedValue(undefined) };
    const service = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      makeLogger() as never,
    );

    const result = await service.startRunsForIssues(["a", "b"]);

    expect(result.started).toEqual(["a", "b"]);
    expect(result.skipped).toEqual([]);
    expect(orchestrator.startRun).toHaveBeenCalledTimes(2);
  });

  it("skips an issue that already has an active run without starting it", async () => {
    const runRepo = {
      findActiveByIssueId: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(id === "a" ? { id: "run-a" } : null),
      ),
    };
    const orchestrator = { startRun: vi.fn().mockResolvedValue(undefined) };
    const service = new LinearPollService(
      {} as never,
      runRepo as never,
      orchestrator as never,
      {} as never,
      makeLogger() as never,
    );

    const result = await service.startRunsForIssues(["a", "b"]);

    expect(result.started).toEqual(["b"]);
    expect(result.skipped).toEqual(["a"]);
    expect(orchestrator.startRun).toHaveBeenCalledTimes(1);
  });

  it("skips and logs an issue whose startRun call fails", async () => {
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

    const result = await service.startRunsForIssues(["a"]);

    expect(result.started).toEqual([]);
    expect(result.skipped).toEqual(["a"]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "a", error: "boom" }),
      "Failed to start run for issue",
    );
  });
});
