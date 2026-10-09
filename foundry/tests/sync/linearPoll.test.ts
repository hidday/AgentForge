import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
    title: "Issue",
    description: "",
    branchName: "ai/issue",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> & { name: string }): RepoEntry {
  return {
    directory: "/repos/" + overrides.name,
    defaultBranch: "main",
    allowedPaths: [],
    protectedPaths: [],
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 100,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    ...overrides,
  };
}

function makeDeps() {
  const linearClient = { searchIssues: vi.fn() };
  const runRepo = { findActiveByIssueId: vi.fn() };
  const orchestrator = { startRun: vi.fn() };
  const repoRegistry = { listRepos: vi.fn() };
  const logger = makeLogger();
  return { linearClient, runRepo, orchestrator, repoRegistry, logger };
}

function build(deps: ReturnType<typeof makeDeps>) {
  return new LinearPollService(
    deps.linearClient as never,
    deps.runRepo as never,
    deps.orchestrator as never,
    deps.repoRegistry as never,
    deps.logger as never,
  );
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("warns and returns [] when no repos are configured for project or assigneeMe polling", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ name: "repo-a" })]);
    const service = build(deps);

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(deps.logger.warn).toHaveBeenCalled();
    expect(deps.linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds one filter per linearProject/assigneeMe repo and skips issues with an active run", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "proj-repo", linearProject: "Project A" }),
      makeRepoEntry({ name: "assignee-repo", assigneeMe: true, linearTeam: "ENG" }),
      makeRepoEntry({ name: "unrelated-repo" }),
    ]);
    deps.linearClient.searchIssues
      .mockResolvedValueOnce([makeIssue({ id: "i1" }), makeIssue({ id: "i2" })])
      .mockResolvedValueOnce([makeIssue({ id: "i3" })]);
    deps.runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "i2" ? { id: "run-existing" } : null),
    );

    const service = build(deps);
    const result = await service.discoverPendingIssues();

    expect(deps.linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(deps.linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Project A",
      assigneeMe: undefined,
      team: undefined,
      state: "Todo",
    });
    expect(deps.linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: undefined,
      assigneeMe: true,
      team: "ENG",
      state: "Todo",
    });
    expect(result.map((i) => i.id)).toEqual(["i1", "i3"]);
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ candidateCount: 2 }),
      "Discovered pending Linear issues",
    );
  });

  it("dedupes an issue id seen across multiple filters", async () => {
    const deps = makeDeps();
    deps.repoRegistry.listRepos.mockReturnValue([
      makeRepoEntry({ name: "repo-a", linearProject: "A" }),
      makeRepoEntry({ name: "repo-b", linearProject: "B" }),
    ]);
    deps.linearClient.searchIssues
      .mockResolvedValueOnce([makeIssue({ id: "dup" })])
      .mockResolvedValueOnce([makeIssue({ id: "dup" }), makeIssue({ id: "new" })]);
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);

    const service = build(deps);
    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["dup", "new"]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts runs for issues without an active run", async () => {
    const deps = makeDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    deps.orchestrator.startRun.mockResolvedValue({ id: "run-1" });
    const service = build(deps);

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: ["issue-1"], skipped: [] });
    expect(deps.orchestrator.startRun).toHaveBeenCalledWith("issue-1");
    expect(deps.logger.info).toHaveBeenCalledWith(
      { started: 1, skipped: 0 },
      "Ingested Linear issues",
    );
  });

  it("skips issues that already have an active run without starting one", async () => {
    const deps = makeDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue({ id: "existing-run" });
    const service = build(deps);

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(deps.orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("logs an error and marks the issue skipped when startRun throws", async () => {
    const deps = makeDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    deps.orchestrator.startRun.mockRejectedValue(new Error("start failed"));
    const service = build(deps);

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "issue-1", error: "start failed" }),
      "Failed to start run for issue",
    );
  });

  it("stringifies a non-Error rejection from startRun when logging the error", async () => {
    const deps = makeDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    deps.orchestrator.startRun.mockRejectedValue("transport closed");
    const service = build(deps);

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "issue-1", error: "transport closed" }),
      "Failed to start run for issue",
    );
  });

  it("handles a mix of started, skipped-existing, and skipped-error issues", async () => {
    const deps = makeDeps();
    deps.runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "existing" ? { id: "run-x" } : null),
    );
    deps.orchestrator.startRun.mockImplementation((id: string) =>
      id === "fails" ? Promise.reject(new Error("boom")) : Promise.resolve({ id: `run-${id}` }),
    );
    const service = build(deps);

    const result = await service.startRunsForIssues(["ok", "existing", "fails"]);

    expect(result.started).toEqual(["ok"]);
    expect(result.skipped).toEqual(["existing", "fails"]);
  });
});
