import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Issue",
    description: "desc",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 1,
    ...overrides,
  };
}

function makeDeps() {
  const linearClient = { searchIssues: vi.fn().mockResolvedValue([]) };
  const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
  const orchestrator = { startRun: vi.fn().mockResolvedValue(undefined) };
  const repoRegistry = { listRepos: vi.fn().mockReturnValue([]) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { linearClient, runRepo, orchestrator, repoRegistry, logger };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new LinearPollService(
    deps.linearClient as never,
    deps.runRepo as never,
    deps.orchestrator as never,
    deps.repoRegistry as never,
    deps.logger as never,
  );
}

describe("LinearPollService.discoverPendingIssues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("warns and returns empty when no repos have linearProject or assigneeMe configured", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([{ name: "a", directory: "/a" }]);
    const service = makeService(deps);

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
    expect(deps.linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds one filter per qualifying repo and dedupes issues already seen across filters", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      { name: "a", directory: "/a", linearProject: "Core" },
      { name: "b", directory: "/b", assigneeMe: true, linearTeam: "PRY" },
    ]);
    const shared = makeIssue({ id: "shared-1" });
    const onlyInSecond = makeIssue({ id: "only-2" });
    deps.linearClient.searchIssues.mockImplementation(async (filter) => {
      if (filter.projectName === "Core") return [shared];
      return [shared, onlyInSecond];
    });

    const service = makeService(deps);
    const result = await service.discoverPendingIssues();

    expect(deps.linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(deps.linearClient.searchIssues).toHaveBeenNthCalledWith(1, {
      projectName: "Core",
      assigneeMe: undefined,
      team: undefined,
      state: "Todo",
    });
    expect(deps.linearClient.searchIssues).toHaveBeenNthCalledWith(2, {
      projectName: undefined,
      assigneeMe: true,
      team: "PRY",
      state: "Todo",
    });
    expect(result.map((i) => i.id)).toEqual(["shared-1", "only-2"]);
  });

  it("excludes issues that already have an active run", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([{ name: "a", directory: "/a", linearProject: "Core" }]);
    const candidate = makeIssue({ id: "candidate-1" });
    deps.linearClient.searchIssues.mockResolvedValue([candidate]);
    deps.runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-existing" });

    const service = makeService(deps);
    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts a run for each issue without an active run", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    const result = await service.startRunsForIssues(["issue-1", "issue-2"]);

    expect(deps.orchestrator.startRun).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ started: ["issue-1", "issue-2"], skipped: [] });
  });

  it("skips issues that already have an active run", async () => {
    const deps = makeDeps();
    deps.runRepo.findActiveByIssueId.mockImplementation(async (id: string) =>
      id === "issue-1" ? { id: "existing-run" } : null,
    );
    const service = makeService(deps);

    const result = await service.startRunsForIssues(["issue-1", "issue-2"]);

    expect(deps.orchestrator.startRun).toHaveBeenCalledTimes(1);
    expect(deps.orchestrator.startRun).toHaveBeenCalledWith("issue-2");
    expect(result).toEqual({ started: ["issue-2"], skipped: ["issue-1"] });
  });

  it("skips and logs an error when orchestrator.startRun throws", async () => {
    const deps = makeDeps();
    deps.orchestrator.startRun.mockRejectedValue(new Error("boom"));
    const service = makeService(deps);

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(deps.logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error thrown value in the log", async () => {
    const deps = makeDeps();
    deps.orchestrator.startRun.mockRejectedValue("plain string failure");
    const service = makeService(deps);

    await service.startRunsForIssues(["issue-1"]);

    expect(deps.logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "plain string failure" },
      "Failed to start run for issue",
    );
  });
});
