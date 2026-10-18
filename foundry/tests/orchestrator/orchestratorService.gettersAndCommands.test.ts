import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
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
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildDeps() {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };
  const artifactRepo = { create: vi.fn(), findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn() };
  const linearClient = { getIssue: vi.fn(), postComment: vi.fn(), getRelatedContext: vi.fn() };
  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn(),
  };
  const linearSync = { syncState: vi.fn() };
  const githubSync = {
    syncState: vi.fn(),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
    postExecutionReportUpdate: vi.fn(),
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
    removeWorktree: vi.fn(),
    resolveMainRepoPath: vi.fn(),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
  };

  return {
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
  };
}

describe("OrchestratorService accessor getters", () => {
  it("exposes the repositories and linear client it was constructed with", () => {
    const deps = buildDeps();
    const svc = new OrchestratorService(deps as never);

    expect(svc.getRunRepo()).toBe(deps.runRepo);
    expect(svc.getArtifactRepo()).toBe(deps.artifactRepo);
    expect(svc.getEventRepo()).toBe(deps.eventRepo);
    expect(svc.getLinearClient()).toBe(deps.linearClient);
    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });

  it("exposes the optional agentSkillRepo when provided", () => {
    const deps = buildDeps();
    const agentSkillRepo = { findTopKByRelevance: vi.fn() };
    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);
    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
  });
});

describe("OrchestratorService.handleLinearWebhook", () => {
  it("is a no-op for issue.created", async () => {
    const deps = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.updated", async () => {
    const deps = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("delegates to handleCommand for comment.command when a command is present", async () => {
    const deps = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);
    const command = { type: "ai-plan" as const };

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1", command });

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", command);
  });

  it("does not call handleCommand for comment.command when no command is attached", async () => {
    const deps = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it("routes ai-plan to startRun", async () => {
    const deps = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("routes run-ai to startRun", async () => {
    const deps = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan: approves and executes the active run when one exists", async () => {
    const deps = buildDeps();
    const activeRun = makeRun({ id: "run-42" });
    deps.runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(activeRun);
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(activeRun);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).toHaveBeenCalledWith("run-42");
    expect(runExecutionSpy).toHaveBeenCalledWith("run-42");
  });

  it("approve-plan: does nothing when there is no active run for the issue", async () => {
    const deps = buildDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan");

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).not.toHaveBeenCalled();
  });

  it("reject-plan: rejects the active run with the command body", async () => {
    const deps = buildDeps();
    const activeRun = makeRun({ id: "run-42" });
    deps.runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const svc = new OrchestratorService(deps as never);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(activeRun);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs more detail" });

    expect(rejectPlanSpy).toHaveBeenCalledWith("run-42", "needs more detail", "linear");
  });

  it("reject-plan: does nothing when there is no active run", async () => {
    const deps = buildDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan");

    await svc.handleCommand("LIN-1", { type: "reject-plan" });

    expect(rejectPlanSpy).not.toHaveBeenCalled();
  });

  it("re-review: re-reviews the active run", async () => {
    const deps = buildDeps();
    const activeRun = makeRun({ id: "run-42" });
    deps.runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(activeRun);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).toHaveBeenCalledWith("run-42");
  });

  it("re-review: does nothing when there is no active run", async () => {
    const deps = buildDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview");

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).not.toHaveBeenCalled();
  });

  it("pause-ai: transitions the active run to AIBlocked via BLOCKED", async () => {
    const deps = buildDeps();
    const activeRun = makeRun({ id: "run-42", state: RunState.Implementing });
    deps.runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIBlocked }));
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(deps.runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.AIBlocked);
  });

  it("pause-ai: does nothing when there is no active run", async () => {
    const deps = buildDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(deps.runRepo.updateState).not.toHaveBeenCalled();
  });

  it("resume-ai: transitions the active run back to Todo via RESET_TO_TODO", async () => {
    const deps = buildDeps();
    const activeRun = makeRun({ id: "run-42", state: RunState.AIBlocked });
    deps.runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Todo }));
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(deps.runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.Todo);
  });

  it("resume-ai: does nothing when there is no active run", async () => {
    const deps = buildDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(deps.runRepo.updateState).not.toHaveBeenCalled();
  });

  it("unknown: logs a warning and does not touch any run", async () => {
    const deps = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/bogus" });

    expect(deps.runRepo.findActiveByIssueId).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
  });
});

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating a new one", async () => {
    const deps = buildDeps();
    const activeRun = makeRun({ id: "run-existing", state: RunState.Planning });
    deps.runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(activeRun);
    expect(deps.runRepo.create).not.toHaveBeenCalled();
    expect(deps.linearClient.getIssue).not.toHaveBeenCalled();
  });
});
