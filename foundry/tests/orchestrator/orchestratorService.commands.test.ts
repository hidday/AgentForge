import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run } from "../../src/domain/types.js";
import type { Review } from "../../src/schemas/review.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: 42,
    state: RunState.ReadyForHumanReview,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/worktree",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "review-1",
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Done",
    filesChanged: ["a.ts"],
    checks: {
      lint: { status: "pass", details: "" },
      typecheck: { status: "pass", details: "" },
      tests: { status: "pass", details: "" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "clean",
    ...overrides,
  };
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };
  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };
  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
    findByRunId: vi.fn().mockResolvedValue([]),
  };
  const linearClient = {
    getIssue: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
  };
  const githubClient = { getPRDiff: vi.fn() };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn(),
  };
  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };
  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn(),
    commitAndPush: vi.fn(),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/main-repo"),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
  };

  return {
    deps: {
      runRepo,
      artifactRepo,
      eventRepo,
      linearClient,
      githubClient,
      gitService,
      repoRegistry,
      linearSync,
      githubSync,
      plannerAgent,
      planReviewerAgent,
      planReviserAgent,
      executorAgent,
      reviewerAgent,
      remediationAgent,
      logger,
      dashboardEmitter,
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    gitService,
    logger,
    linearSync,
    githubSync,
    dashboardEmitter,
  };
}

describe("OrchestratorService.handleLinearWebhook", () => {
  it("dispatches comment.command with a command to handleCommand", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "unknown", raw: "/foo" },
    });

    expect(spy).toHaveBeenCalledWith("LIN-1", { type: "unknown", raw: "/foo" });
  });

  it("does not call handleCommand for comment.command with no command payload", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.created and issue.updated actions", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });
    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("ai-plan and run-ai both call startRun", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" });
    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(startRunSpy).toHaveBeenCalledTimes(2);
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("approve-plan approves and executes when an active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-2" }));
    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).toHaveBeenCalledWith("run-2");
    expect(runExecutionSpy).toHaveBeenCalledWith("run-2");
  });

  it("approve-plan is a no-op when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan");

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).not.toHaveBeenCalled();
  });

  it("reject-plan calls rejectPlan with the command body and source='linear'", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-3" }));
    const svc = new OrchestratorService(deps as never);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "not good" });

    expect(rejectPlanSpy).toHaveBeenCalledWith("run-3", "not good", "linear");
  });

  it("re-review calls runReview when an active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-4" }));
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).toHaveBeenCalledWith("run-4");
  });

  it("pause-ai transitions the active run with BLOCKED", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const run = makeRun({ id: "run-5", state: RunState.Implementing });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-5", state: RunState.AIBlocked }));
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-5", eventType: RunEvent.BLOCKED, source: "user-command" }),
    );
  });

  it("resume-ai transitions the active run with RESET_TO_TODO", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const run = makeRun({ id: "run-6", state: RunState.AIBlocked });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-6", state: RunState.Todo }));
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-6",
        eventType: RunEvent.RESET_TO_TODO,
        source: "user-command",
      }),
    );
  });

  it("pause-ai/resume-ai are no-ops when there is no active run", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });
    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(eventRepo.create).not.toHaveBeenCalled();
  });

  it("logs a warning for an unknown command and takes no action", async () => {
    const { deps, logger, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/whatever" });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.markReady", () => {
  it("posts the ready-for-review comment when policy allows", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const run = makeRun({ prNumber: 42 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review") return Promise.resolve({ payloadJson: makeReview() });
      if (type === "ExecutionReport") return Promise.resolve({ payloadJson: makeExecutionReport() });
      return Promise.resolve(null);
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.markReady("run-1");

    expect(result.id).toBe("run-1");
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
  });

  it("throws (via PolicyEngine) when the run is not eligible", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ prNumber: null }));
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toThrow();
  });

  it("throws when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("missing")).rejects.toThrow("Run not found: missing");
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("transitions to Done, posts a comment, cleans up the worktree, and updates skill metrics", async () => {
    const { deps, runRepo, linearClient, gitService, eventRepo } = buildDeps();
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/repo/.worktrees/run-1" });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done, workingDirectory: "/repo/.worktrees/run-1" }));
    gitService.resolveMainRepoPath.mockReturnValue("/repo");

    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockResolvedValue({ id: "skill-1" }),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["skill-1"] }, createdAt: new Date() },
    ]);

    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Human review approved"),
    );
    expect(gitService.removeWorktree).toHaveBeenCalledWith("/repo", "/repo/.worktrees/run-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith({ id: "skill-1" });
  });

  it("swallows a distillationAgent failure (best-effort) and still completes the run", async () => {
    const { deps, runRepo, linearClient } = buildDeps();
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("distillation boom")) };
    const svc = new OrchestratorService({ ...deps, distillationAgent } as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalled();
  });

  it("does not run the worktree cleanup when the working directory has no .worktrees segment (main repo path already)", async () => {
    const { deps, runRepo, gitService } = buildDeps();
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/repo" });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done, workingDirectory: "/repo" }));
    gitService.resolveMainRepoPath.mockReturnValue("/repo");

    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });
});
