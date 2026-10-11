import { describe, it, expect, vi } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Issue title",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeDeps(overrides: {
  repos?: Record<string, unknown>[];
  searchIssues?: ReturnType<typeof vi.fn>;
  findActiveByIssueId?: ReturnType<typeof vi.fn>;
  startRun?: ReturnType<typeof vi.fn>;
} = {}) {
  const linearClient = {
    searchIssues: overrides.searchIssues ?? vi.fn().mockResolvedValue([]),
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    postComment: vi.fn(),
    updateIssueState: vi.fn(),
    addLabel: vi.fn(),
    removeLabel: vi.fn(),
    listLabels: vi.fn(),
  };
  const runRepo = {
    findActiveByIssueId: overrides.findActiveByIssueId ?? vi.fn().mockResolvedValue(null),
  };
  const orchestrator = {
    startRun: overrides.startRun ?? vi.fn().mockResolvedValue({ id: "run-1" }),
  };
  const repoRegistry = {
    listRepos: vi.fn().mockReturnValue(overrides.repos ?? []),
  };
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
    const { service, logger } = makeDeps({ repos: [{ name: "r1" }] });

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "No Linear projects or assigneeMe repos configured in repo registry",
    );
  });

  it("builds a filter from a repo's linearProject and searches with state=Todo", async () => {
    const searchIssues = vi.fn().mockResolvedValue([]);
    const { service } = makeDeps({
      repos: [{ name: "r1", linearProject: "Proj A", linearTeam: "PRY" }],
      searchIssues,
    });

    await service.discoverPendingIssues();

    expect(searchIssues).toHaveBeenCalledWith({
      projectName: "Proj A",
      assigneeMe: undefined,
      team: "PRY",
      state: "Todo",
    });
  });

  it("builds a filter from assigneeMe=true when linearProject is absent", async () => {
    const searchIssues = vi.fn().mockResolvedValue([]);
    const { service } = makeDeps({
      repos: [{ name: "r1", assigneeMe: true }],
      searchIssues,
    });

    await service.discoverPendingIssues();

    expect(searchIssues).toHaveBeenCalledWith({
      projectName: undefined,
      assigneeMe: true,
      team: undefined,
      state: "Todo",
    });
  });

  it("excludes repos with neither linearProject nor assigneeMe configured", async () => {
    const searchIssues = vi.fn().mockResolvedValue([]);
    const { service } = makeDeps({
      repos: [{ name: "r1" }, { name: "r2", linearProject: "Proj" }],
      searchIssues,
    });

    await service.discoverPendingIssues();

    expect(searchIssues).toHaveBeenCalledTimes(1);
  });

  it("deduplicates issues returned by multiple repo filters", async () => {
    const shared = makeIssue({ id: "shared-1" });
    const searchIssues = vi
      .fn()
      .mockResolvedValueOnce([shared])
      .mockResolvedValueOnce([shared, makeIssue({ id: "unique-1" })]);
    const { service } = makeDeps({
      repos: [
        { name: "r1", linearProject: "Proj A" },
        { name: "r2", linearProject: "Proj B" },
      ],
      searchIssues,
    });

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id).sort()).toEqual(["shared-1", "unique-1"]);
  });

  it("excludes issues that already have an active run", async () => {
    const findActiveByIssueId = vi.fn().mockImplementation((id: string) =>
      Promise.resolve(id === "has-run" ? { id: "run-1" } : null),
    );
    const searchIssues = vi
      .fn()
      .mockResolvedValue([makeIssue({ id: "has-run" }), makeIssue({ id: "no-run" })]);
    const { service } = makeDeps({
      repos: [{ name: "r1", linearProject: "Proj A" }],
      searchIssues,
      findActiveByIssueId,
    });

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["no-run"]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue id and reports it as started", async () => {
    const startRun = vi.fn().mockResolvedValue({ id: "run-1" });
    const { service } = makeDeps({ startRun });

    const result = await service.startRunsForIssues(["issue-1", "issue-2"]);

    expect(startRun).toHaveBeenCalledWith("issue-1");
    expect(startRun).toHaveBeenCalledWith("issue-2");
    expect(result).toEqual({ started: ["issue-1", "issue-2"], skipped: [] });
  });

  it("skips an issue id that already has an active run without calling startRun", async () => {
    const findActiveByIssueId = vi.fn().mockResolvedValue({ id: "existing-run" });
    const startRun = vi.fn();
    const { service } = makeDeps({ findActiveByIssueId, startRun });

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(startRun).not.toHaveBeenCalled();
    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
  });

  it("catches an error from startRun, logs it, and marks the issue skipped", async () => {
    const startRun = vi.fn().mockRejectedValue(new Error("boom"));
    const { service, logger } = makeDeps({ startRun });

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "boom" },
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error thrown value when logging the failure", async () => {
    const startRun = vi.fn().mockRejectedValue("plain string failure");
    const { service, logger } = makeDeps({ startRun });

    await service.startRunsForIssues(["issue-1"]);

    expect(logger.error).toHaveBeenCalledWith(
      { issueId: "issue-1", error: "plain string failure" },
      "Failed to start run for issue",
    );
  });

  it("handles a mix of started and skipped issues in one call", async () => {
    const findActiveByIssueId = vi.fn().mockImplementation((id: string) =>
      Promise.resolve(id === "already-running" ? { id: "run-x" } : null),
    );
    const startRun = vi
      .fn()
      .mockImplementation((id: string) =>
        id === "fails" ? Promise.reject(new Error("fail")) : Promise.resolve({ id: "run-ok" }),
      );
    const { service } = makeDeps({ findActiveByIssueId, startRun });

    const result = await service.startRunsForIssues(["already-running", "fails", "ok"]);

    expect(result.started).toEqual(["ok"]);
    expect(result.skipped.sort()).toEqual(["already-running", "fails"]);
  });

  it("returns empty started/skipped arrays for an empty input", async () => {
    const { service } = makeDeps();

    const result = await service.startRunsForIssues([]);

    expect(result).toEqual({ started: [], skipped: [] });
  });
});
