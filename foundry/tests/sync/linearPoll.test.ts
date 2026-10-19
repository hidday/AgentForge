import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "/repos/repo-a",
    defaultBranch: "main",
    allowedPaths: [],
    protectedPaths: [],
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 50,
      maxDiffLines: 2000,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    ...overrides,
  };
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    title: "Title",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeDeps() {
  const linearClient = { searchIssues: vi.fn(), getIssue: vi.fn() };
  const runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
  const orchestrator = { startRun: vi.fn() };
  const repoRegistry = { listRepos: vi.fn().mockReturnValue([]) };
  return { linearClient, runRepo, orchestrator, repoRegistry };
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns an empty array and warns when no repo is configured for Linear polling", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([makeRepoEntry()]);
    const logger = makeLogger();
    const service = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      logger as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
    expect(deps.linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds one filter per repo with linearProject or assigneeMe configured", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "a", linearProject: "Alpha", linearTeam: "ENG" }),
      makeRepoEntry({ name: "b", assigneeMe: true }),
      makeRepoEntry({ name: "c" }),
    ]);
    deps.linearClient.searchIssues.mockResolvedValue([]);
    const service = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      makeLogger() as never,
    );

    await service.discoverPendingIssues();

    expect(deps.linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(deps.linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Alpha",
      assigneeMe: undefined,
      team: "ENG",
      state: "Todo",
    });
    expect(deps.linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: undefined,
      assigneeMe: true,
      team: undefined,
      state: "Todo",
    });
  });

  it("de-duplicates issues seen across multiple repo filters", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "a", linearProject: "Alpha" }),
      makeRepoEntry({ name: "b", linearProject: "Beta" }),
    ]);
    const shared = makeIssue({ id: "shared-1" });
    deps.linearClient.searchIssues
      .mockResolvedValueOnce([shared])
      .mockResolvedValueOnce([shared, makeIssue({ id: "unique-1" })]);

    const service = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      makeLogger() as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id).sort()).toEqual(["shared-1", "unique-1"]);
  });

  it("excludes issues that already have an active run", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ linearProject: "Alpha" })]);
    deps.linearClient.searchIssues.mockResolvedValue([
      makeIssue({ id: "has-run" }),
      makeIssue({ id: "no-run" }),
    ]);
    deps.runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "has-run" ? { id: "run-1" } : null),
    );

    const service = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      makeLogger() as never,
    );

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["no-run"]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts runs for issues with no existing active run", async () => {
    const deps = makeDeps();
    deps.orchestrator.startRun.mockResolvedValue({ id: "run-new" });
    const service = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      makeLogger() as never,
    );

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: ["issue-1"], skipped: [] });
    expect(deps.orchestrator.startRun).toHaveBeenCalledWith("issue-1");
  });

  it("skips an issue that already has an active run without starting a new one", async () => {
    const deps = makeDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-existing" });
    const service = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      makeLogger() as never,
    );

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(deps.orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("skips and logs an error when startRun throws", async () => {
    const deps = makeDeps();
    deps.orchestrator.startRun.mockRejectedValue(new Error("boom"));
    const logger = makeLogger();
    const service = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      logger as never,
    );

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(logger.error).toHaveBeenCalled();
  });

  it("processes a mix of started and skipped issues independently", async () => {
    const deps = makeDeps();
    deps.runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "existing" ? { id: "run-1" } : null),
    );
    deps.orchestrator.startRun.mockResolvedValue({ id: "run-new" });

    const service = new LinearPollService(
      deps.linearClient as never,
      deps.runRepo as never,
      deps.orchestrator as never,
      deps.repoRegistry as never,
      makeLogger() as never,
    );

    const result = await service.startRunsForIssues(["existing", "new-1"]);

    expect(result.started).toEqual(["new-1"]);
    expect(result.skipped).toEqual(["existing"]);
  });
});
