import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearPollService } from "../../src/sync/linearPoll.js";
import type { LinearClient, LinearIssue } from "../../src/linear/linearClient.js";
import type { RunRepository } from "../../src/orchestrator/runRepository.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import type { RepoRegistry, RepoEntry } from "../../src/config/repoRegistry.js";
import type { Run } from "../../src/domain/types.js";
import { RunState } from "../../src/domain/runState.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    title: "Do the thing",
    description: "desc",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

function makeRepoEntry(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    name: "repo-a",
    directory: "./repo-a",
    defaultBranch: "main",
    allowedPaths: [],
    protectedPaths: [],
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 1000,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    ...overrides,
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "repo-a",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("LinearPollService", () => {
  let linearClient: { searchIssues: ReturnType<typeof vi.fn> };
  let runRepo: { findActiveByIssueId: ReturnType<typeof vi.fn> };
  let orchestrator: { startRun: ReturnType<typeof vi.fn> };
  let repoRegistry: { listRepos: ReturnType<typeof vi.fn> };
  let logger: ReturnType<typeof makeLogger>;
  let service: LinearPollService;

  beforeEach(() => {
    linearClient = { searchIssues: vi.fn().mockResolvedValue([]) };
    runRepo = { findActiveByIssueId: vi.fn().mockResolvedValue(null) };
    orchestrator = { startRun: vi.fn().mockResolvedValue(makeRun()) };
    repoRegistry = { listRepos: vi.fn().mockReturnValue([]) };
    logger = makeLogger();
    service = new LinearPollService(
      linearClient as unknown as LinearClient,
      runRepo as unknown as RunRepository,
      orchestrator as unknown as OrchestratorService,
      repoRegistry as unknown as RepoRegistry,
      logger as never,
    );
  });

  describe("discoverPendingIssues", () => {
    it("returns an empty array and warns when no repos are configured for Linear polling", async () => {
      repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ linearProject: undefined, assigneeMe: undefined })]);

      const result = await service.discoverPendingIssues();

      expect(result).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        "No Linear projects or assigneeMe repos configured in repo registry",
      );
      expect(linearClient.searchIssues).not.toHaveBeenCalled();
    });

    it("builds filters from repos with linearProject or assigneeMe, and returns new candidates", async () => {
      repoRegistry.listRepos.mockReturnValue([
        makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
        makeRepoEntry({ name: "repo-b", assigneeMe: true, linearTeam: "TeamB" }),
        makeRepoEntry({ name: "repo-c" }),
      ]);

      const issueA = makeIssue({ id: "a1" });
      const issueB = makeIssue({ id: "b1" });
      linearClient.searchIssues
        .mockResolvedValueOnce([issueA])
        .mockResolvedValueOnce([issueB]);

      const result = await service.discoverPendingIssues();

      expect(linearClient.searchIssues).toHaveBeenCalledTimes(2);
      expect(linearClient.searchIssues).toHaveBeenNthCalledWith(1, {
        projectName: "Project A",
        assigneeMe: undefined,
        team: undefined,
        state: "Todo",
      });
      expect(linearClient.searchIssues).toHaveBeenNthCalledWith(2, {
        projectName: undefined,
        assigneeMe: true,
        team: "TeamB",
        state: "Todo",
      });
      expect(result).toEqual([issueA, issueB]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ candidateCount: 2 }),
        "Discovered pending Linear issues",
      );
    });

    it("dedupes issues seen in multiple filters", async () => {
      repoRegistry.listRepos.mockReturnValue([
        makeRepoEntry({ name: "repo-a", linearProject: "Project A" }),
        makeRepoEntry({ name: "repo-b", linearProject: "Project B" }),
      ]);

      const shared = makeIssue({ id: "shared-1" });
      linearClient.searchIssues.mockResolvedValueOnce([shared]).mockResolvedValueOnce([shared]);

      const result = await service.discoverPendingIssues();
      expect(result).toEqual([shared]);
    });

    it("excludes issues that already have an active run", async () => {
      repoRegistry.listRepos.mockReturnValue([makeRepoEntry({ linearProject: "Project A" })]);
      const issue = makeIssue({ id: "has-run" });
      linearClient.searchIssues.mockResolvedValueOnce([issue]);
      runRepo.findActiveByIssueId.mockResolvedValueOnce(makeRun({ linearIssueId: "has-run" }));

      const result = await service.discoverPendingIssues();
      expect(result).toEqual([]);
    });
  });

  describe("startRunsForIssues", () => {
    it("starts runs for new issue ids", async () => {
      const result = await service.startRunsForIssues(["i1", "i2"]);

      expect(orchestrator.startRun).toHaveBeenCalledWith("i1");
      expect(orchestrator.startRun).toHaveBeenCalledWith("i2");
      expect(result).toEqual({ started: ["i1", "i2"], skipped: [] });
      expect(logger.info).toHaveBeenCalledWith(
        { started: 2, skipped: 0 },
        "Ingested Linear issues",
      );
    });

    it("skips issues that already have an active run without starting them", async () => {
      runRepo.findActiveByIssueId.mockResolvedValueOnce(makeRun({ linearIssueId: "i1" }));

      const result = await service.startRunsForIssues(["i1"]);

      expect(orchestrator.startRun).not.toHaveBeenCalled();
      expect(result).toEqual({ started: [], skipped: ["i1"] });
    });

    it("skips and logs an error when startRun throws an Error", async () => {
      orchestrator.startRun.mockRejectedValueOnce(new Error("boom"));

      const result = await service.startRunsForIssues(["i1"]);

      expect(result).toEqual({ started: [], skipped: ["i1"] });
      expect(logger.error).toHaveBeenCalledWith(
        { issueId: "i1", error: "boom" },
        "Failed to start run for issue",
      );
    });

    it("skips and logs a stringified error when startRun throws a non-Error", async () => {
      orchestrator.startRun.mockRejectedValueOnce("weird failure");

      const result = await service.startRunsForIssues(["i1"]);

      expect(result).toEqual({ started: [], skipped: ["i1"] });
      expect(logger.error).toHaveBeenCalledWith(
        { issueId: "i1", error: "weird failure" },
        "Failed to start run for issue",
      );
    });

    it("handles an empty array of issue ids", async () => {
      const result = await service.startRunsForIssues([]);
      expect(result).toEqual({ started: [], skipped: [] });
      expect(orchestrator.startRun).not.toHaveBeenCalled();
    });
  });
});
