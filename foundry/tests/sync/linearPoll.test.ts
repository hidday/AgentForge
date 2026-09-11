import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    title: "Sample",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("LinearPollService.discoverPendingIssues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("warns and returns an empty array when no repos are configured for Linear polling", async () => {
    const linearClient = { searchIssues: vi.fn() };
    const runRepo = { findActiveByIssueId: vi.fn() };
    const orchestrator = { startRun: vi.fn() };
    const repoRegistry = { listRepos: vi.fn().mockReturnValue([{ name: "r1" }]) };
    const logger = makeLogger();

    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds a search filter per eligible repo and returns issues without an active run", async () => {
    const issueA = makeIssue({ id: "a" });
    const issueB = makeIssue({ id: "b" });
    const linearClient = {
      searchIssues: vi
        .fn()
        .mockResolvedValueOnce([issueA])
        .mockResolvedValueOnce([issueB]),
    };
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = { startRun: vi.fn() };
    const repoRegistry = {
      listRepos: vi.fn().mockReturnValue([
        { name: "r1", linearProject: "Proj1", linearTeam: "PRY" },
        { name: "r2", assigneeMe: true },
        { name: "r3" }, // not eligible: no linearProject, no assigneeMe
      ]),
    };
    const logger = makeLogger();

    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenNthCalledWith(1, {
      projectName: "Proj1",
      assigneeMe: undefined,
      team: "PRY",
      state: "Todo",
    });
    expect(linearClient.searchIssues).toHaveBeenNthCalledWith(2, {
      projectName: undefined,
      assigneeMe: true,
      team: undefined,
      state: "Todo",
    });
    expect(result.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("deduplicates issues seen across multiple filters", async () => {
    const sharedIssue = makeIssue({ id: "shared" });
    const linearClient = {
      searchIssues: vi
        .fn()
        .mockResolvedValueOnce([sharedIssue])
        .mockResolvedValueOnce([sharedIssue]),
    };
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = { startRun: vi.fn() };
    const repoRegistry = {
      listRepos: vi.fn().mockReturnValue([
        { name: "r1", linearProject: "Proj1" },
        { name: "r2", linearProject: "Proj2" },
      ]),
    };
    const logger = makeLogger();

    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("shared");
  });

  it("excludes issues that already have an active run", async () => {
    const issueA = makeIssue({ id: "a" });
    const issueB = makeIssue({ id: "b" });
    const linearClient = {
      searchIssues: vi.fn().mockResolvedValue([issueA, issueB]),
    };
    const runRepo = {
      findActiveByIssueId: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(id === "a" ? { id: "run-1" } : null),
      ),
    };
    const orchestrator = { startRun: vi.fn() };
    const repoRegistry = {
      listRepos: vi.fn().mockReturnValue([{ name: "r1", linearProject: "Proj1" }]),
    };
    const logger = makeLogger();

    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["b"]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts runs for issues without an existing active run", async () => {
    const linearClient = { searchIssues: vi.fn() };
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = { startRun: vi.fn().mockResolvedValue({ id: "run-1" }) };
    const repoRegistry = { listRepos: vi.fn() };
    const logger = makeLogger();

    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: ["issue-1"], skipped: [] });
    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-1");
  });

  it("skips issues that already have an active run without starting a new one", async () => {
    const linearClient = { searchIssues: vi.fn() };
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue({ id: "run-existing" }) };
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

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("catches errors from orchestrator.startRun, logs them, and marks the issue skipped", async () => {
    const linearClient = { searchIssues: vi.fn() };
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = {
      startRun: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const repoRegistry = { listRepos: vi.fn() };
    const logger = makeLogger();

    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("handles a non-Error rejection from orchestrator.startRun by stringifying it", async () => {
    const linearClient = { searchIssues: vi.fn() };
    const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    const orchestrator = {
      startRun: vi.fn().mockRejectedValue("plain string failure"),
    };
    const repoRegistry = { listRepos: vi.fn() };
    const logger = makeLogger();

    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "plain string failure" },
      "Failed to start run for issue",
    );
  });

  it("processes a mix of started and skipped issues, logging the summary counts", async () => {
    const linearClient = { searchIssues: vi.fn() };
    const runRepo = {
      findActiveByIssueId: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(id === "existing" ? { id: "run-1" } : null),
      ),
    };
    const orchestrator = { startRun: vi.fn().mockResolvedValue({ id: "run-new" }) };
    const repoRegistry = { listRepos: vi.fn() };
    const logger = makeLogger();

    const service = new LinearPollService(
      linearClient as never,
      runRepo as never,
      orchestrator as never,
      repoRegistry as never,
      logger as never,
    );

    const result = await service.startRunsForIssues(["new-1", "existing"]);

    expect(result).toEqual({ started: ["new-1"], skipped: ["existing"] });
    expect(logger.info).toHaveBeenCalledWith(
      { started: 1, skipped: 1 },
      "Ingested Linear issues",
    );
  });

  it("returns empty started/skipped for an empty input array", async () => {
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

    const result = await service.startRunsForIssues([]);

    expect(result).toEqual({ started: [], skipped: [] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });
});
