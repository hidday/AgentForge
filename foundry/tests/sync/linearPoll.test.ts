import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";
import type { RepoEntry } from "../../src/config/repoRegistry.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeLinearClient() {
  return {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn(),
    postComment: vi.fn(),
    updateIssueState: vi.fn(),
    addLabel: vi.fn(),
    removeLabel: vi.fn(),
    listLabels: vi.fn(),
  };
}

function makeRunRepo() {
  return {
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
  };
}

function makeOrchestrator() {
  return {
    startRun: vi.fn().mockResolvedValue({}),
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "repo-a",
    defaultBranch: "main",
    allowedPaths: [],
    protectedPaths: [],
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 50,
      maxDiffLines: 1000,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    ...overrides,
  };
}

function makeRepoRegistry(repos: RepoEntry[]) {
  return { listRepos: vi.fn().mockReturnValue(repos) };
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Some issue",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function buildService(
  linearClient: ReturnType<typeof makeLinearClient>,
  runRepo: ReturnType<typeof makeRunRepo>,
  orchestrator: ReturnType<typeof makeOrchestrator>,
  repoRegistry: ReturnType<typeof makeRepoRegistry>,
) {
  return new LinearPollService(
    linearClient as never,
    runRepo as never,
    orchestrator as never,
    repoRegistry as never,
    makeLogger() as never,
  );
}

describe("LinearPollService.discoverPendingIssues", () => {
  it("returns an empty array and warns when no repos are configured for polling", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([makeRepoEntry({ linearProject: undefined, assigneeMe: undefined })]);
    const service = buildService(linearClient, runRepo, orchestrator, repoRegistry);

    const result = await service.discoverPendingIssues();

    expect(result).toEqual([]);
    expect(linearClient.searchIssues).not.toHaveBeenCalled();
  });

  it("builds one filter per eligible repo (linearProject or assigneeMe) and searches each", async () => {
    const linearClient = makeLinearClient();
    linearClient.searchIssues.mockResolvedValue([]);
    const runRepo = makeRunRepo();
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([
      makeRepoEntry({ name: "proj-repo", linearProject: "Project A" }),
      makeRepoEntry({ name: "assignee-repo", assigneeMe: true, linearTeam: "ENG" }),
      makeRepoEntry({ name: "excluded-repo", linearProject: undefined, assigneeMe: undefined }),
    ]);
    const service = buildService(linearClient, runRepo, orchestrator, repoRegistry);

    await service.discoverPendingIssues();

    expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: "Project A",
      assigneeMe: undefined,
      team: undefined,
      state: "Todo",
    });
    expect(linearClient.searchIssues).toHaveBeenCalledWith({
      projectName: undefined,
      assigneeMe: true,
      team: "ENG",
      state: "Todo",
    });
  });

  it("deduplicates issues seen across multiple filters", async () => {
    const linearClient = makeLinearClient();
    const sharedIssue = makeIssue({ id: "shared-issue" });
    linearClient.searchIssues
      .mockResolvedValueOnce([sharedIssue])
      .mockResolvedValueOnce([sharedIssue, makeIssue({ id: "only-in-second" })]);
    const runRepo = makeRunRepo();
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([
      makeRepoEntry({ name: "repo-a", linearProject: "A" }),
      makeRepoEntry({ name: "repo-b", linearProject: "B" }),
    ]);
    const service = buildService(linearClient, runRepo, orchestrator, repoRegistry);

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id).sort()).toEqual(["only-in-second", "shared-issue"]);
  });

  it("excludes issues that already have an active run", async () => {
    const linearClient = makeLinearClient();
    linearClient.searchIssues.mockResolvedValue([
      makeIssue({ id: "has-run" }),
      makeIssue({ id: "no-run" }),
    ]);
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockImplementation((id: string) =>
      Promise.resolve(id === "has-run" ? { id: "run-1" } : null),
    );
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([makeRepoEntry({ linearProject: "A" })]);
    const service = buildService(linearClient, runRepo, orchestrator, repoRegistry);

    const result = await service.discoverPendingIssues();

    expect(result.map((i) => i.id)).toEqual(["no-run"]);
  });
});

describe("LinearPollService.startRunsForIssues", () => {
  it("starts a run for each issue with no active run", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([]);
    const service = buildService(linearClient, runRepo, orchestrator, repoRegistry);

    const result = await service.startRunsForIssues(["issue-1", "issue-2"]);

    expect(result).toEqual({ started: ["issue-1", "issue-2"], skipped: [] });
    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-1");
    expect(orchestrator.startRun).toHaveBeenCalledWith("issue-2");
  });

  it("skips issues that already have an active run without calling startRun", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    runRepo.findActiveByIssueId.mockResolvedValue({ id: "run-1" });
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([]);
    const service = buildService(linearClient, runRepo, orchestrator, repoRegistry);

    const result = await service.startRunsForIssues(["issue-1"]);

    expect(result).toEqual({ started: [], skipped: ["issue-1"] });
    expect(orchestrator.startRun).not.toHaveBeenCalled();
  });

  it("skips and logs when orchestrator.startRun throws, without aborting remaining issues", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    const orchestrator = makeOrchestrator();
    orchestrator.startRun
      .mockRejectedValueOnce(new Error("preflight failed"))
      .mockResolvedValueOnce({});
    const repoRegistry = makeRepoRegistry([]);
    const service = buildService(linearClient, runRepo, orchestrator, repoRegistry);

    const result = await service.startRunsForIssues(["bad-issue", "good-issue"]);

    expect(result).toEqual({ started: ["good-issue"], skipped: ["bad-issue"] });
  });

  it("returns empty started/skipped for an empty issue id list", async () => {
    const linearClient = makeLinearClient();
    const runRepo = makeRunRepo();
    const orchestrator = makeOrchestrator();
    const repoRegistry = makeRepoRegistry([]);
    const service = buildService(linearClient, runRepo, orchestrator, repoRegistry);

    const result = await service.startRunsForIssues([]);

    expect(result).toEqual({ started: [], skipped: [] });
  });
});
